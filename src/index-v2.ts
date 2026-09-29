import { createOpenAI } from "@ai-sdk/openai"
import type { Plugin } from "@opencode/plugin"
import LegacyPlugin from "./index.js"
import {
  syncActiveAccountToOpenCode,
  syncActiveAccountToOpenCodeV2,
  writeAccountCredentialsToOpenCode,
} from "./auth-sync.js"
import { getNextAccount } from "./rotation.js"
import { decodeJwtPayload } from "./codex-auth.js"

const PROVIDER_ID = "openai"
const JWT_CLAIM_PATH = "https://api.openai.com/auth"
const ACCOUNT_ID_HEADER = "chatgpt-account-id"

type LegacyAuth = {
  type?: string
  access?: string
  refresh?: string
  expires?: number
}

type LegacyAuthorization = {
  url: string
  method: "auto"
  instructions: string
  callback: () => Promise<{
    type: "success" | "failed"
    access?: string
    refresh?: string
    expires?: number
  }>
}

type LegacyHooks = {
  auth: {
    loader: (getAuth: () => Promise<LegacyAuth | undefined>, provider: unknown) => Promise<Record<string, unknown>>
    methods: Array<{
      label: string
      type: "oauth" | "api"
      prompts?: Array<{ type: "text"; key: string; message: string; placeholder?: string }>
      authorize?: (inputs?: Record<string, string>) => Promise<LegacyAuthorization>
    }>
  }
}

type SessionHookContext = {
  sessionID?: string
  model?: { providerID?: string; id?: string; variant?: string }
  headers?: Record<string, string>
  body?: { model?: string }
}

/**
 * Extracts the ChatGPT account id from an OAuth access token.
 */
function getAccountIdFromToken(token: string): string | undefined {
  const claims = decodeJwtPayload(token)
  return claims?.[JWT_CLAIM_PATH]?.chatgpt_account_id as string | undefined
}

/**
 * Bridges the upstream v1 account store and rotation engine to OpenCode 2.
 *
 * OpenCode 2.0.x resolves the OpenAI OAuth credential from its own store
 * (`auth.json` + the `credential` row in `opencode.db`) *after* the model
 * request hooks run, and attaches its own `Authorization` header. The AI SDK
 * `sdk` hook is no longer invoked for that credential (the provider SDK is
 * cached before plugins register), so rotation has to drive the credential
 * OpenCode itself will read:
 *
 *  - `session.hook("model.request")` picks the next account with
 *    `getNextAccount()` (rotation strategy, force mode, enabled flags and
 *    rate-limit state all apply) and writes that account's credential into
 *    OpenCode's store. The consequent request therefore authenticates as the
 *    rotated account.
 *  - `aisdk.hook("sdk")` is kept for builds where the AI SDK hook still runs.
 */
async function legacyHooks(): Promise<LegacyHooks> {
  return (await (LegacyPlugin as unknown as (input: unknown) => Promise<LegacyHooks>)({ client: {} })) as LegacyHooks
}

const plugin = {
  id: "opencode-multi-auth-codex",
  setup: async (context: any) => {
    syncActiveAccountToOpenCode()
    await syncActiveAccountToOpenCodeV2()
    const legacy = await legacyHooks()

    if (context?.session?.hook) {
      await context.session.hook("model.request", async (ctx: SessionHookContext) => {
        try {
          if (ctx?.model?.providerID !== PROVIDER_ID) return ctx
          const rotation = await getNextAccount({} as never, {
            model: ctx?.body?.model ?? ctx?.model?.id,
          })
          if (!rotation) return ctx

          const { account, token } = rotation
          await writeAccountCredentialsToOpenCode(account)

          const accountId = account.accountId ?? getAccountIdFromToken(token)
          ctx.headers = ctx.headers ?? {}
          if (accountId) ctx.headers[ACCOUNT_ID_HEADER] = accountId
        } catch (error) {
          console.warn(`[multi-auth] request rotation failed: ${error}`)
        }
        return ctx
      })
    } else {
      console.warn("[multi-auth] session hooks unavailable in this OpenCode build; falling back to AI SDK hook")
    }

    await context.aisdk.hook(
      "sdk",
      async (event: any) => {
        if (event.model.providerID !== PROVIDER_ID || event.package !== "@ai-sdk/openai") return
        const loader = await legacy.auth.loader(async () => undefined, undefined)
        event.sdk = createOpenAI({ ...event.options, ...loader })
      },
      { providerID: PROVIDER_ID },
    )
  },
} satisfies Plugin.Plugin

export default plugin
