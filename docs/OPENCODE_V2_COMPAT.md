# OpenCode 2 compatibility and credential rotation

This document records the local fork's OpenCode 2 support and the fix applied on
2026-09-30 for OpenCode `2.0.19`. It is the maintenance reference for anyone
revisiting the port.

## Why this fork exists

OpenCode 2 changed its plugin contract. A plugin is now loaded as a definition
object (`{ id, setup }`) instead of the v1 factory, and OpenCode 2 keeps its own
OAuth credential for the `openai` integration. The upstream v1 `auth.loader`
fetch that performed account rotation is no longer enough on its own.

The port keeps the upstream account store, token refresh, rate-limit tracking
and rotation engine untouched, and adds the OpenCode 2 integration points in
`src/index-v2.ts` + `src/auth-sync.ts`.

## The 2.0.19 problem

Symptom: every `openai/*` request returned `The usage limit has been reached`
even though other accounts had quota. `activeAlias`, `lastUsed` and `usageCount`
never changed, i.e. rotation never ran.

Root cause, confirmed by instrumenting the OpenCode binary:

1. OpenCode 2.0.x caches the provider SDK (`cache.get(key) ?? runSDK(...)`) and
   only runs `aisdk.hook("sdk")` on a cache miss. The `openai` SDK is built
   before a local plugin's `setup()` registers its hook, so the plugin's
   rotating `customFetch` was never installed.
2. OpenCode resolves the OpenAI OAuth credential from its own store
   (`~/.local/share/opencode/auth.json` and the `credential` row in
   `~/.local/share/opencode/opencode.db`) and attaches its own `Authorization`
   header. The plugin did not participate in that resolution.
3. The startup sync to that store was gated by token expiry and only ran in
   `setup()`, so switching accounts never moved the credential OpenCode uses.

`aisdk.hook` in 2.0.19 exposes only `sdk` and `language`, both inside the
memoised provider builder. The session-level `http.request` / `http.response`
hooks are only installed when `has("session","http.request", providerID)` is
true, which does not happen for `openai`; a handler registered there never
receives OpenAI requests.

## The fix

`session.hook("model.request")` is emitted for `openai` requests. The handler:

1. Calls `getNextAccount()` from the upstream rotation engine, so the configured
   strategy (`round-robin`, `least-used`, `random`, `weighted-round-robin`),
   Force Mode, `enabled` flags and `rateLimitedUntil` all apply.
2. Writes the selected account's credential into OpenCode's store through
   `writeAccountCredentialsToOpenCode()` (`auth.json` + the `credential` row of
   `opencode.db`), bypassing the expiry gate.

Because OpenCode resolves that credential *after* the hook runs, the request is
authenticated as the rotated account. This restores per-request rotation.

## Files

| File | Change |
|---|---|
| `src/index-v2.ts` | Registers `session.hook("model.request")` to rotate and sync; keeps `aisdk.hook("sdk")` for builds where it still fires. |
| `src/auth-sync.ts` | Adds `writeAccountCredentialsToOpenCode(account)`: unconditional credential write to `auth.json` and `opencode.db`. |
| `dist/**` | Built output committed so the plugin folder can be used directly. |

## Build and deploy

```bash
npm run build            # tsc -> dist/
```

OpenCode loads a local plugin from the path configured in
`~/.config/opencode/opencode.json` (`plugin` array). Copy `dist/` (and
`server.ts`) to that folder, for example:

```bash
PLUGIN_DIR="$HOME/Documents/Codex/2026-09-29/ho/outputs/opencode-multi-auth-codex-v2"
rm -rf "$PLUGIN_DIR/dist" && cp -r dist "$PLUGIN_DIR/dist"
```

The plugin folder's `server.ts` re-exports `dist/index-v2.js`:

```ts
export { default } from "./dist/index-v2.js"
```

## Activation after a deploy

A running OpenCode process keeps the plugin module it loaded at startup. After
deploying, restart the process that hosts the sessions:

- Background service: `opencode service restart`
- OpenCode LAN server (systemd, port 4096): `sudo systemctl restart opencode-lan`

`opencode reload` is broken in 2.0.19 (`ServiceUnavailableError: ue is not a
function`), so it cannot be used to pick up plugin changes.

## Verification

With OpenCode's internal credential pointed at an exhausted account, sending
real requests through the restarted service returns successful responses while
`usageCount` advances for the healthy accounts and `activeAlias` rotates. An
exhausted account is skipped while `rateLimitedUntil` is set (populated by the
dashboard's limit refresh) and rejoins automatically once its window resets.

## Caveats

- Rotation is evaluated per model request, not per user message, so usage
  counters advance a little more often than one per turn.
- Exhaustion is detected through the multi-auth limit refresh (dashboard
  "Refresh limits" / `oc-recover-limits`), not by intercepting the 429, because
  the `http.response` hook is not installed for `openai`.
- Accounts must be OAuth-logged-in through the dashboard so they carry
  `accessToken` / `refreshToken` / `expiresAt`.
- If OpenCode changes plugin loading again, re-check `aisdk.hook` availability
  and whether `session.hook("model.request")` still fires for `openai`.
