import type { Auth } from '@opencode-ai/sdk';
import type { AccountCredentials } from './types.js';
/**
 * OpenCode 2 verifies the native OpenAI credential before the AI SDK hook can
 * replace its fetch. Keep that credential aligned with the active multi-auth
 * account, but only ever move it forward in expiry time. This complements the
 * stale-input guards above: native OpenCode auth cannot overwrite the store,
 * while this function may safely refresh native auth from the newer store.
 */
export declare function syncActiveAccountToOpenCode(): boolean;
/**
 * OpenCode 2 migrates OAuth credentials into its SQLite database and resolves
 * that record before an AI SDK hook runs. Bun exposes SQLite in-process, so
 * refresh the single OpenAI credential at plugin startup as well. Node-based
 * tests and the dashboard CLI intentionally skip this Bun-only operation.
 */
export declare function syncActiveAccountToOpenCodeV2(): Promise<boolean>;
/**
 * Writes one account's OAuth credentials into the native auth file and the
 * OpenCode 2 SQLite credential, without the expiry guard used by the startup
 * sync. OpenCode 2 resolves the OpenAI credential from that record on every
 * model request, so this is what makes a per-request account rotation take
 * effect. Safe to call repeatedly: writes are idempotent.
 */
export declare function writeAccountCredentialsToOpenCode(account: AccountCredentials): Promise<boolean>;
export declare function syncAuthFromOpenCode(getAuth: () => Promise<Auth>): Promise<void>;
//# sourceMappingURL=auth-sync.d.ts.map