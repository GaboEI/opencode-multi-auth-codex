import type { Auth } from '@opencode-ai/sdk'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { addAccount, loadStore, updateAccount } from './store.js'
import { decodeJwtPayload, getAccountIdFromClaims, getEmailFromClaims } from './codex-auth.js'
import type { AccountCredentials } from './types.js'

const OPENAI_ISSUER = 'https://auth.openai.com'
const AUTH_SYNC_COOLDOWN_MS = 10_000
const OPENCODE_AUTH_FILE = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json')
const OPENCODE_DATABASE_FILE = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db')

let lastSyncedAccess: string | null = null
let lastSyncAt = 0

async function fetchEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${OPENAI_ISSUER}/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) return undefined
    const user = (await res.json()) as { email?: string }
    return user.email
  } catch {
    return undefined
  }
}

function findAccountAliasByToken(access: string, refresh?: string): string | null {
  const store = loadStore()
  for (const account of Object.values(store.accounts)) {
    if (account.accessToken === access) return account.alias
    if (refresh && account.refreshToken === refresh) return account.alias
  }
  return null
}

function findAccountAliasByEmail(email: string, store: ReturnType<typeof loadStore>): string | null {
  for (const account of Object.values(store.accounts)) {
    if (account.email && account.email === email) return account.alias
  }
  return null
}

function buildAlias(email: string | undefined, existingAliases: Set<string>): string {
  const base = email ? email.split('@')[0] : 'account'
  let candidate = base || 'account'
  let suffix = 1
  while (existingAliases.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

// Native OpenCode auth is not refreshed by the multi-auth dashboard. Do not
// let an older native token overwrite the newer token in accounts.json.
function updateAccountIfNotStale(alias: string, updates: Partial<AccountCredentials>): boolean {
  const currentAccount = loadStore().accounts[alias]
  const incomingExpires = typeof updates.expiresAt === 'number' ? updates.expiresAt : 0
  const currentExpires = typeof currentAccount?.expiresAt === 'number' ? currentAccount.expiresAt : 0
  if (currentAccount && incomingExpires < currentExpires) {
    console.warn(`[multi-auth] stale sync skipped (${alias})`)
    return false
  }
  updateAccount(alias, updates)
  return true
}

/**
 * OpenCode 2 verifies the native OpenAI credential before the AI SDK hook can
 * replace its fetch. Keep that credential aligned with the active multi-auth
 * account, but only ever move it forward in expiry time. This complements the
 * stale-input guards above: native OpenCode auth cannot overwrite the store,
 * while this function may safely refresh native auth from the newer store.
 */
export function syncActiveAccountToOpenCode(): boolean {
  if (process.env.OPENCODE_MULTI_AUTH_SKIP_NATIVE_SYNC === '1') return false

  const store = loadStore()
  const account = store.activeAlias ? store.accounts[store.activeAlias] : undefined
  if (!account?.accessToken || !account.refreshToken || !account.expiresAt) return false

  let auth: Record<string, any> = {}
  try {
    if (fs.existsSync(OPENCODE_AUTH_FILE)) auth = JSON.parse(fs.readFileSync(OPENCODE_AUTH_FILE, 'utf8'))
  } catch {
    return false
  }

  const existingExpiry = typeof auth.openai?.expires === 'number' ? auth.openai.expires : 0
  if (existingExpiry >= account.expiresAt) return false

  const next = {
    ...auth,
    openai: {
      type: 'oauth',
      access: account.accessToken,
      refresh: account.refreshToken,
      expires: account.expiresAt,
      ...(account.accountId ? { accountId: account.accountId } : {})
    }
  }
  try {
    const temporary = `${OPENCODE_AUTH_FILE}.multi-auth-${process.pid}-${Date.now()}`
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 })
    fs.renameSync(temporary, OPENCODE_AUTH_FILE)
    return true
  } catch {
    return false
  }
}

/**
 * OpenCode 2 migrates OAuth credentials into its SQLite database and resolves
 * that record before an AI SDK hook runs. Bun exposes SQLite in-process, so
 * refresh the single OpenAI credential at plugin startup as well. Node-based
 * tests and the dashboard CLI intentionally skip this Bun-only operation.
 */
export async function syncActiveAccountToOpenCodeV2(): Promise<boolean> {
  if (process.env.OPENCODE_MULTI_AUTH_SKIP_NATIVE_SYNC === '1' || !process.versions.bun) return false

  const store = loadStore()
  const account = store.activeAlias ? store.accounts[store.activeAlias] : undefined
  if (!account?.accessToken || !account.refreshToken || !account.expiresAt) return false

  try {
    const sqliteSpecifier = 'bun:sqlite'
    const sqlite: any = await import(sqliteSpecifier)
    const database = new sqlite.Database(OPENCODE_DATABASE_FILE)
    try {
      const credential: any = database
        .query("SELECT id, value FROM credential WHERE integration_id = 'openai'")
        .get()
      if (!credential?.id || typeof credential.value !== 'string') return false

      const current = JSON.parse(credential.value)
      const currentExpiry = typeof current?.expires === 'number' ? current.expires : 0
      if (currentExpiry >= account.expiresAt) return false

      const value = {
        ...current,
        type: 'oauth',
        methodID: current.methodID || 'chatgpt-browser',
        access: account.accessToken,
        refresh: account.refreshToken,
        expires: account.expiresAt,
        metadata: {
          ...(current.metadata || {}),
          ...(account.accountId ? { accountID: account.accountId } : {})
        }
      }
      database
        .query("UPDATE credential SET value = ?, time_updated = ? WHERE id = ? AND integration_id = 'openai'")
        .run(JSON.stringify(value), Date.now(), credential.id)
      return true
    } finally {
      database.close()
    }
  } catch {
    return false
  }
}

export async function syncAuthFromOpenCode(getAuth: () => Promise<Auth>): Promise<void> {
  const now = Date.now()
  if (now - lastSyncAt < AUTH_SYNC_COOLDOWN_MS) return
  lastSyncAt = now

  let auth: Auth | null = null
  try {
    auth = await getAuth()
  } catch {
    return
  }

  if (!auth || auth.type !== 'oauth') return
  if (!auth.access) return
  if (auth.access === lastSyncedAccess) return

  lastSyncedAccess = auth.access

  const existingAlias = findAccountAliasByToken(auth.access, auth.refresh)
  const accessClaims = decodeJwtPayload(auth.access)
  const derivedEmail = getEmailFromClaims(accessClaims)
  const derivedAccountId = getAccountIdFromClaims(accessClaims)
  if (existingAlias) {
    updateAccountIfNotStale(existingAlias, {
      accessToken: auth.access,
      refreshToken: auth.refresh,
      expiresAt: auth.expires,
      email: derivedEmail,
      accountId: derivedAccountId
    })
    return
  }

  const store = loadStore()
  const email = (await fetchEmail(auth.access)) || derivedEmail
  if (email) {
    const existingByEmail = findAccountAliasByEmail(email, store)
    if (existingByEmail) {
      updateAccountIfNotStale(existingByEmail, {
        accessToken: auth.access,
        refreshToken: auth.refresh,
        expiresAt: auth.expires,
        email
      })
      return
    }
  }
  const alias = buildAlias(email, new Set(Object.keys(store.accounts)))

  addAccount(alias, {
    accessToken: auth.access,
    refreshToken: auth.refresh,
    expiresAt: auth.expires,
    email,
    accountId: derivedAccountId,
    source: 'opencode'
  })
}
