// OpenCode 2 resolves local plugins through the `server` entrypoint before
// consulting package metadata. Keep this bridge tiny so upstream source and
// our v2 implementation remain separately rebaseable.
export { default } from "./dist/index-v2.js"
