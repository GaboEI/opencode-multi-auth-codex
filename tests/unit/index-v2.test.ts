import plugin from '../../src/index-v2.js'

describe('OpenCode 2 plugin entry', () => {
  it('registers the OpenAI SDK rotation hook through the v2 setup adapter', async () => {
    let sdkHook: any

    const context = {
      aisdk: {
        hook: async (name: string, callback: unknown, options: unknown) => {
          expect(name).toBe('sdk')
          expect(options).toEqual({ providerID: 'openai' })
          sdkHook = callback
          return { dispose: async () => {} }
        }
      }
    }

    process.env.OPENCODE_MULTI_AUTH_SKIP_NATIVE_SYNC = '1'
    try {
      await plugin.setup(context as any)
    } finally {
      delete process.env.OPENCODE_MULTI_AUTH_SKIP_NATIVE_SYNC
    }

    expect(plugin.id).toBe('opencode-multi-auth-codex')
    expect(typeof sdkHook).toBe('function')

    const event: any = {
      model: { providerID: 'openai' },
      package: '@ai-sdk/openai',
      options: {},
      sdk: undefined
    }
    await sdkHook(event)

    expect(typeof event.sdk.responses).toBe('function')
  })
})
