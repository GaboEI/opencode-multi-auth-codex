import type { Auth } from '@opencode-ai/sdk';
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
export declare function syncAuthFromOpenCode(getAuth: () => Promise<Auth>): Promise<void>;
//# sourceMappingURL=auth-sync.d.ts.map