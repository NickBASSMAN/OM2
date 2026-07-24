# Online Modeli

Browser extension for tracking selected cam model rooms across supported sites.

Current version: `0.3.8`

## Status

Online Modeli is usable for daily tracking and is still pre-`1.0.0`. The main architecture is in place: site definitions, per-site API adapters, linked rooms, popup previews, and JSON import/export.

Versioning rules:

* Third digit: small UI, behavior, and compatibility changes
* Second digit: new sites and larger feature changes
* `1.0.0`: first complete stable version

## Supported Sites

* Chaturbate: status, viewers, stream timing, restricted room states, hover preview
* BongaCams: status, viewers, stream timing when available, hover preview
* Stripchat: API-backed status, viewers, thumbnails, and linked-room tracking

## Main Features

* Add a model from the currently opened room page
* Link one tracked model to rooms on multiple supported sites
* Track online, offline, public, private, group, room-pass, and region-blocked states where available
* Show viewer count, thumbnails, and stream timing metadata when a site exposes it
* Hover supported thumbnails to preview a refreshed image stream
* Open the display room or any linked room directly from the popup
* Import and export model lists as JSON
* Periodic background refresh with popup badge count
* Popup-open refresh throttling to avoid unnecessary API traffic

## Changelog

### 0.3.8

* Optimized Chaturbate update loop by restricting the roomlist directory scan to models known to be online from basic check, and added a search limit of 10 pages (top 1000 rooms)
* Optimized local storage write logic in background service by checking for deep differences before saving, which avoids redundant badge updates and rendering cycles
* Fixed summer/winter time (DST) shifts in Kyiv stream timing logs by replacing the fixed `"Etc/GMT-2"` timezone configuration with `"Europe/Kyiv"`
* Implemented DOM Reconciliation (DOM-diffing and element reuse) in the popup panel, preventing layout flickering and thumbnail reloading, while preserving scroll position and active controls

### 0.3.7

* Added Stripchat API integration through `core/api.js` and the background adapter layer
* Added Stripchat model listing, snapshot thumbnail mapping, viewer count, and status normalization
* Added `doppiocdn.media` host permission for Stripchat thumbnails
* Reworked import/export into shared `popup/model-io.js`
* Export payload is now `version: 5` and preserves linked rooms, status snapshots, media URLs, added order, and platform data
* Import now supports older array/object payloads, `links`, and current `linkedRooms`, then forces a background refresh
* Batch refresh now updates primary and linked rooms across supported site adapters
* Popup refresh uses a short cache window on open while manual refresh and import force an update
* Online thumbnails refresh periodically with cache-busting

### 0.2.6

* Fixed Chaturbate `roomlogin/<username>` URL parsing for password-protected rooms
* Added Chaturbate restricted room states: `room pass` and `region`
* Preserved Chaturbate relative last broadcast text during room-list refreshes
* Site icons beside linked rooms now open that exact room URL

## Multi-Site Links

Each tracked model has one primary room and can have additional linked rooms on other supported sites.

Workflow:

1. Open a supported room page.
2. Press the main add button to track it as a new model.
3. Open the same model's room on another supported site.
4. Press the add-link button on the existing popup row.
5. The room is saved under the same model unless it is already linked.

The popup shows a site icon for each room. Each icon reflects that room's own status and opens that exact room when clicked.

Display behavior:

* If the primary room is Stripchat, the Stripchat row remains the display identity
* Otherwise, the first online room in added order controls row status, thumbnail, and preview
* If all rooms are offline, the primary room status is shown

## Import And Export

Export creates a JSON file named like `models-YYYYMMDD-HHMM.json`.

Current export payload:

```json
{
  "version": 5,
  "exportedAt": "2026-05-21T00:00:00.000Z",
  "models": []
}
```

The payload preserves:

* primary room identity and added order
* linked rooms
* status snapshots
* thumbnail and preview URLs
* per-site `platformData`, including Stripchat stream metadata

Import accepts:

* current `version: 5` exports
* older `{ "models": [...] }` exports
* raw model arrays
* legacy `links` arrays

Imported rooms are normalized and deduplicated. Live statuses are reset to offline before storage, then the extension forces a background refresh so Chaturbate, BongaCams, and Stripchat adapters can fetch fresh state.

## Installation

Firefox temporary install:

1. Open `about:debugging`
2. Select **This Firefox**
3. Click **Load Temporary Add-on**
4. Select `manifest.json`

## Usage

1. Open a supported model room.
2. Click the extension button.
3. Press the main add button to track the current room.
4. Use the row add-link button to attach the current room to an existing model.
5. Hover a thumbnail to preview when preview is supported.
6. Click a model row or a site icon to open the corresponding room.
7. Use the import/export buttons in the popup toolbar to move model lists between installs.

## Technical Notes

* Manifest V3 WebExtension
* JavaScript only
* Stores data in `browser.storage.local`
* Background scripts load `shared/sites.js`, `core/api.js`, `sites/background-adapters.js`, then `background.js`
* Shared site parsing and model normalization live in `shared/sites.js`
* Shared site API code lives in `core/api.js`
* Per-site background behavior lives in `sites/background-adapters.js`
* Import/export normalization lives in `popup/model-io.js`
* Popup image preview uses `imageplayer.js`

## Limitations

* External site APIs can change or block requests without notice
* Stripchat and BongaCams requests can be affected by Cloudflare/session availability
* Stripchat support currently uses listing/snapshot endpoints rather than a dedicated per-room endpoint
* No stream recording functionality
* Manual temporary install only at this stage

## Roadmap

* Improve linked-room management UI
* Add clearer per-room status details
* Add stronger import/export validation and migration reporting
* Package the extension for regular installation

## Disclaimer

This extension is intended for personal use. It depends on third-party websites and their public behavior/API responses, which may change without notice.
