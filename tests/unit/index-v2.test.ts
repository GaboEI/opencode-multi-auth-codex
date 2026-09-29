import { Effect } from 'effect'
import plugin from '../../src/index-v2.js'

describe('OpenCode 2 plugin entry', () => {
  it('registers multi-account OAuth and replaces the OpenAI SDK', async () => {
    let registration: any
    let sdkHook: any

    const context = {
      integration: {
        transform: (callback: any) =>
          Effect.sync(() =>
            callback({
              get: (id: string) => (id === 'openai' ? {} : undefined),
              method: { update: (input: unknown) => (registration = input) }
            })
          )
      },
      aisdk: {
        sdk: (callback: unknown) => Effect.sync(() => (sdkHook = callback))
      }
    }

    await Effect.runPromise(Effect.scoped(plugin.effect(context as any)))

    expect(plugin.id).toBe('opencode-multi-auth-codex')
    expect(registration.integrationID).toBe('openai')
    expect(registration.method.id).toBe('multi-auth')
    expect(typeof sdkHook).toBe('function')

    const event: any = {
      model: { providerID: 'openai' },
      package: '@ai-sdk/openai',
      options: {},
      sdk: undefined
    }
    await Effect.runPromise(sdkHook(event))

    expect(typeof event.sdk.responses).toBe('function')
  })
})
