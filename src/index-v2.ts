import { createOpenAI } from "@ai-sdk/openai"
import type { Plugin } from "@opencode/plugin"
import LegacyPlugin from "./index.js"

const PROVIDER_ID = "openai"

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

/**
 * Bridges the upstream v1 account store and rotation engine to OpenCode 2.
 *
 * The upstream module remains unmodified: it retains the account store, token
 * refresh, rate-limit tracking and retrying fetch implementation. This entry
 * supplies the OpenCode 2 integrations and AI SDK hooks that replaced v1's
 * `auth.loader` hook.
 */
async function legacyHooks(): Promise<LegacyHooks> {
  // The v1 factory only calls these client helpers from its optional session
  // notification hooks. The v2 entry does not install those hooks because v2
  // has no public event subscription API yet.
  return (await (LegacyPlugin as unknown as (input: unknown) => Promise<LegacyHooks>)({ client: {} })) as LegacyHooks
}

const plugin = {
  id: "opencode-multi-auth-codex",
  setup: async (context) => {
    const legacy = await legacyHooks()
    await context.aisdk.hook(
      "sdk",
      async (event) => {
        if (event.model.providerID !== PROVIDER_ID || event.package !== "@ai-sdk/openai") return
        const loader = await legacy.auth.loader(async () => undefined, undefined)
        event.sdk = createOpenAI({ ...event.options, ...loader })
      },
      { providerID: PROVIDER_ID },
    )
  },
} satisfies Plugin.Plugin

export default plugin
