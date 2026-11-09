# Local drafts and history

The current editable recipe is saved under `aski:draft` in this browser's localStorage. This is a small anonymous draft, separate from the future IndexedDB library, saved artifacts and account sync. Clearing browser data can remove it. No session or email token is stored here.

Envelope version 2 contains the complete supported recipe and an update timestamp. Version 1 (`{schemaVersion:1, recipe:…}`) migrates on the next successful save. Recovery validates font/engine provenance and recipe version. Corrupt data, unknown versions and unavailable font identities remain untouched; a warning lets the user explicitly replace that key with the active draft. Storage access and quota failures keep editing/copy available and offer retry. Other storage keys are never cleared. Temporarily over-limit text is retained up to 100,000 code units; rendering continues to enforce its 2,000-unit limit.

Undo and redo hold up to 100 complete recipe snapshots for the current page session. Reload restores the recipe and starts a fresh history. A new edit clears redo; focus, copy status, hover and playback are excluded. Later supported recipe fields join this same explicit versioned boundary rather than separate UI histories. Buttons and Ctrl/Cmd+Z (Shift for redo) are available; sign-in/manual-copy fields retain their own native editing behavior.

`make test-storage` covers recovery, migration, invalid data, persistence failures and history. The browser suite adds real reloads, style changes, keyboard undo, explicit replacement, quota recovery and unrelated-key retention.
