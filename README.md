# Online Modeli

Browser extension for tracking selected cam models across supported sites.

Current version: `0.2.6`

## Status

Online Modeli is in active development. The extension is usable for daily tracking, but the project is not considered `1.0.0` complete yet.

Versioning rules:

* Third digit: small UI and behavior changes
* Second digit: new sites and larger feature changes
* `1.0.0`: first complete stable version

## Supported Sites

* Chaturbate: status, viewers, stream time, hover preview
* BongaCams: status, viewers, stream time, hover preview
* Stripchat: planned / partial groundwork only

## Main Features

* Add a model from the currently opened room page
* Track online, offline, public, private, group, and password-style room states where available
* Show viewer count and stream time
* Hover over supported thumbnails to preview the live stream
* Open tracked rooms from the popup
* Import and export model lists as JSON
* Periodic background refresh with popup badge count
* Link one model to rooms on multiple supported sites

## Changelog

### 0.2.6

* Fixed Chaturbate `roomlogin/<username>` URL parsing for password-protected rooms
* Added Chaturbate restricted room states: `room pass` for password-required rooms and `region` for region/gender-blocked rooms
* Restricted Chaturbate states are shown as orange warning statuses while still using room-list thumbnail, preview, viewer count, and stream timing when available
* Preserved Chaturbate relative last broadcast text instead of replacing it with a fixed date during room-list refreshes
* Site icons beside linked rooms now open that exact room URL

## Multi-Site Links

Each tracked model has one primary room and can have additional linked rooms on other sites.

Workflow:

1. Add the model from the first room page.
2. Open the same model's room on another supported site.
3. In the popup, press the add-link button on the existing model row.
4. If that room is not already linked, it is saved under the same model.

The popup shows a site icon for each linked room. Each icon reflects that room's own status and opens that exact room when clicked.

When a model is online in multiple rooms, popup display status follows the order in which rooms were added:

* Primary room first
* Then linked rooms in added order
* The first online room in that order controls the row status, thumbnail, and preview
* If all rooms are offline, the primary room status is shown

## Installation

Firefox temporary install:

1. Open `about:debugging`
2. Select **This Firefox**
3. Click **Load Temporary Add-on**
4. Select `manifest.json`

## Usage

1. Open a supported model room.
2. Click the extension button.
3. Press the main add button to track the current room as a new model.
4. Use the row add-link button to attach the current room to an existing model.
5. Hover a thumbnail to preview when preview is supported.
6. Click a model row or a site icon to open the room.

## Technical Notes

* Manifest V3 WebExtension
* JavaScript only
* Stores data in `browser.storage.local`
* Uses background adapters per site
* Shared site API code lives in `core/api.js`
* Export format currently uses payload `version: 4`

## Limitations

* Stripchat is not fully implemented yet
* External site APIs can change or block requests
* BongaCams API can be affected by Cloudflare/session availability
* No stream recording functionality
* Manual temporary install only at this stage

## Roadmap

* Complete Stripchat support
* Improve linked-room management UI
* Add clearer per-room status details
* Package the extension for regular installation

## Disclaimer

This extension is intended for personal use. It depends on third-party websites and their public behavior/API responses, which may change without notice.
