# Sound feature UI review

Implemented on site-look for V2.00 against SOUND-FEATURES-CONTRACT.md read from the analysis worktree. Production feature files are intentionally not replaced by fake analysis.

Local preview: serve this worktree over HTTP and visit /?soundFixture=1&gameFixture=1. Portal fixture files live in notes/feature-fixture/portal; Game Library uses the existing notes/fixture export, extended with the exact feature, tag, similarity and binary-map shapes. Both fixture switches are restricted to localhost. Fixture measurements are synthetic, not analysis results.

Portal reads portal-features.json and tags.json beside manifest.json. Similarity is requested on demand. Game Library reads index/tags.json and index/facets.json when its section opens; category pages retain their existing lazy paging and bounded cache. Ranges filter individual clips on the loaded page; global description search ranks the search index's t arrays and names across categories. The contract does not supply numeric features in the global search index. Range and pitched filters therefore cannot filter unloaded Game Library clips globally. The UI states that scope, and the map dims unloaded points when numeric filters are active.

Each section has separate filter state, vocabulary, similar lists and maps. URL parameters portalFilters and gameFilters preserve both sections independently, including existing category, type and language controls. Copy filter link records the active section. Similar links restore the category/page; clicking them or a map point opens and plays the sound. Opening a specific sound clears that section's filters so the selected card is visible. Portal voice map points select the matching line in grouped flag cards.

Map code is a lazy ES module. Portal loads only portal-map.json. Game loads only its own map.json and little-endian map.bin, supporting map-assets-<n>.json arrays (or objects with assets) if the metadata omits assets. Canvas batches points by category with one matching pass, schedules redraws with requestAnimationFrame, and paginates box-selection lists in groups of 100. No continuous animation runs. Null measurements never become zero in range matching.

Checks:

- node test-game-library.cjs includes test-sound-features.cjs: contract fixtures, all eight ranges, combined filters, null/pitched handling, ranked synonyms, independent URL restoration, SHA-1 neighbour shards, map request separation, missing-file handling and 16,000-point decoding.
- node test-look.cjs checks UI cues and HTTP access to the new binary/sharded fixtures and module.
- node check-audio.cjs C:\BF6_Dev\BF6-Modding-SDK-audio\build\sounds-export d8804b4 checks all existing audio and Portal behavior.
- node test-features-browser.cjs runs headless Edge. It uses Playwright from the environment or notes/browser-tools/node_modules. To install locally: npm.cmd install --prefix notes/browser-tools --no-save --package-lock=false playwright. It checks the new UI paths, maps, mobile layout and 16,000-point canvas rendering. CDN libraries are stubbed in this test; audio integrity and existing playback logic remain covered by the original checks.

Visual snapshots from the browser test are in notes/feature-review (ignored by git). Review the real projection's clusters/category colors, tag relevance and pitch readouts when the analysis files land. Also check touch box selection and the compact measurements on narrow screens. Synthetic projection points cannot establish the quality of the final embedding. No publish or push is included.
