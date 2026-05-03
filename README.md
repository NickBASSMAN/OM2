# Online Models Tracker (Browser Extension)

## Overview

Online Models Tracker is a browser extension that allows users to monitor selected cam models without requiring registration on any platform. It provides real-time status updates and key information about models from supported websites.

## Supported Platforms

* Chaturbate (fully supported)
* BongaCams (planned, API ready)
* Stripchat (planned, limited API support)

## Features

* Track selected models without creating an account
* Add models directly from their room page using the extension button
* Real-time model status (online, private, offline, etc.)
* Viewer count in the model’s room
* Display how long a model has been online
* Show last stream time
* Preview live video on thumbnail hover (currently supported except for Stripchat)
* Simple UI with button-based controls

## Current Status

* Fully functional integration with Chaturbate
* Partial groundwork completed for BongaCams and Stripchat

## Installation

Currently, the extension is available only for Mozilla Firefox and must be installed manually.

### Steps:

1. Open Firefox
2. Go to `about:debugging`
3. Select **This Firefox**
4. Click **Load Temporary Add-on**
5. Select the extension’s manifest file

## Usage

1. Open a model’s room on a supported platform
2. Click the extension button to add the model to your tracking list
3. Use the extension interface to manage tracked models
4. Hover over a model thumbnail to preview the live stream (if supported)
5. Click on a model to open their room

## Technical Details

* Built with: JavaScript
* Platform: Mozilla Firefox (WebExtension API)

## Limitations

* Stripchat does not support video preview due to lack of API
* BongaCams integration is not yet enabled
* No stream recording functionality at this stage

## Roadmap (TODO)

* Complete BongaCams integration (API already prepared)
* Implement Stripchat support (without hover preview)
* Allow adding multiple links for the same model across supported platforms
* Display which platform the model is currently streaming on
* Add stream recording functionality

## Disclaimer

This extension is intended for personal use and does not require authentication on third-party platforms. Availability of features depends on external site APIs.

---
