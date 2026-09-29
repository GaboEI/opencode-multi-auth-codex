import { createOpenAI } from "@ai-sdk/openai";
import { define } from "@opencode-ai/plugin/v2/effect";
import { Effect } from "effect";
import LegacyPlugin from "./index.js";
const PROVIDER_ID = "openai";
const METHOD_ID = "multi-auth";
/**
 * Bridges the upstream v1 account store and rotation engine to OpenCode 2.
 *
 * The upstream module remains unmodified: it retains the account store, token
 * refresh, rate-limit tracking and retrying fetch implementation. This entry
 * supplies the OpenCode 2 integrations and AI SDK hooks that replaced v1's
 * `auth.loader` hook.
 */
async function legacyHooks() {
    // The v1 factory only calls these client helpers from its optional session
    // notification hooks. The v2 entry does not install those hooks because v2
    // has no public event subscription API yet.
    return (await LegacyPlugin({ client: {} }));
}
const plugin = define({
    id: "opencode-multi-auth-codex",
    effect: Effect.fn(function* (context) {
        const legacy = yield* Effect.tryPromise({ try: legacyHooks, catch: (cause) => cause }).pipe(Effect.orDie);
        const oauth = legacy.auth.methods.find((method) => method.type === "oauth" && method.authorize);
        if (oauth?.authorize) {
            yield* context.integration.transform((editor) => {
                editor.method.update({
                    integrationID: PROVIDER_ID,
                    method: {
                        id: METHOD_ID,
                        type: "oauth",
                        label: oauth.label,
                        prompts: oauth.prompts,
                    },
                    authorize: (inputs) => Effect.tryPromise({
                        try: async () => {
                            const authorization = await oauth.authorize?.(inputs);
                            if (!authorization)
                                throw new Error("Multi-auth OAuth authorization could not be started");
                            return {
                                mode: authorization.method,
                                url: authorization.url,
                                instructions: authorization.instructions,
                                callback: Effect.tryPromise({
                                    try: async () => {
                                        const result = await authorization.callback();
                                        if (result.type !== "success" || !result.access || !result.refresh || !result.expires) {
                                            throw new Error("Multi-auth OAuth authorization did not return usable credentials");
                                        }
                                        return {
                                            type: "oauth",
                                            methodID: METHOD_ID,
                                            access: result.access,
                                            refresh: result.refresh,
                                            expires: result.expires,
                                        };
                                    },
                                    catch: (cause) => cause,
                                }),
                            };
                        },
                        catch: (cause) => cause,
                    }),
                });
            });
        }
        yield* context.aisdk.sdk((event) => Effect.tryPromise({
            try: async () => {
                if (event.model.providerID !== PROVIDER_ID || event.package !== "@ai-sdk/openai")
                    return;
                // Account rotation owns its own encrypted/local store. The OAuth method
                // above writes new accounts into that store, so no v1 auth snapshot is
                // needed here.
                const loader = await legacy.auth.loader(async () => undefined, undefined);
                event.sdk = createOpenAI({
                    ...event.options,
                    ...loader,
                });
            },
            catch: (cause) => cause,
        }).pipe(Effect.catch(() => Effect.void)));
    }),
});
export default plugin;
//# sourceMappingURL=index-v2.js.map