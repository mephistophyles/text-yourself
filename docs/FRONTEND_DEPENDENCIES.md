# Frontend dependency decisions

The frontend intentionally has three production dependencies beyond the browser:

- **React / React DOM** provide the component and rendering model selected in the
  architecture. The application uses browser-native forms, dialogs, URLs, and
  fetch rather than adding component, router, form, icon, or request libraries.
- **Dexie** wraps IndexedDB transactions and schema upgrades. Durable ordered
  outbox writes and atomic projection updates are correctness-sensitive; using the
  raw asynchronous IndexedDB event API would add substantial custom plumbing.
- **vite-plugin-pwa** asks Workbox to generate a revisioned application-shell
  service worker from Vite's build output. It avoids maintaining a second manual
  asset manifest that can silently drift from production bundles.

Development dependencies are limited to TypeScript/Vite, the official React Vite
plugin and type packages, and Vitest with Testing Library, jsdom, and fake-indexeddb.
Those test packages exercise browser behavior and IndexedDB replay without a real
backend. No dependency fetches content or sends analytics at runtime.

## Frontend contract assumptions

- API entities and bodies use `snake_case`; dates are ISO-8601 UTC strings and IDs
  are UUID strings. Delete returns the sanitized soft-deleted message so the local
  projection never retains its body.
- The sync envelope is
  `{changes: [{kind: "topic" | "message", data}], next_version, has_more}`.
  The client rejects a `has_more` page whose cursor does not advance rather than
  entering an unbounded loop.
- A 4xx outbox response other than timeout or rate limiting is treated as a
  permanent conflict. It remains durably queued and blocks later mutations in
  order; server/network failures remain retryable on foreground polling,
  reconnection, or manual Sync.
- A browser that has never reached `/api/me` cannot create offline records because
  it has no trustworthy cached author identity. Once identity has been confirmed,
  it is retained in origin-local storage for offline attribution.
- The service worker caches only the built application shell. API data remains in
  IndexedDB and is not duplicated in the HTTP cache.
- The install manifest carries SVG plus opaque 192px and 512px PNG icons, and the
  document declares a 180px Apple touch icon. The raster fallbacks are generated
  from the checked-in SVG source to keep Chromium and Apple Home Screen behavior
  consistent without maintaining separate artwork.
