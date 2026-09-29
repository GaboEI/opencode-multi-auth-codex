import type { Auth } from '@opencode-ai/sdk';
/**
 * OpenCode 2 verifies the native OpenAI credential before the AI SDK hook can
 * replace its fetch. Keep that credential aligned with the active multi-auth
 * account, but only ever move it forward in expiry time. This complements the
 * stale-input guards above: native OpenCode auth cannot overwrite the store,
 * while this function may safely refresh native auth from the newer store.
 */
export declare function syncActiveAccountToOpenCode(): boolean;
export declare function syncAuthFromOpenCode(getAuth: () => Promise<Auth>): Promise<void>;
//# sourceMappingURL=auth-sync.d.ts.map