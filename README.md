# SMS Grades Overview — Browser Extension

A browser extension that adds a grades overview widget to the [sms.eursc.eu](https://sms.eursc.eu) dashboard.

## What it does

- Injects a **grades overview widget** at the top of the SMS dashboard page
- Shows a **general average** across all enabled subjects
- Shows a **card per subject** with the weighted average grade, color-coded
- Shows a **recent grades table** with the last 10 graded assignments across all subjects
- Automatically **discovers enrolled courses** from the SMS grades page
- Allows **hiding/showing courses** via the extension popup (persisted in local storage)

## How it works

1. **Authentication**: The extension piggybacks on the user's existing SMS session (PHPSESSID cookie set after SAML/ADFS login via Office 365). No credentials are stored or handled by the extension.

2. **Course discovery**: On dashboard load, the extension fetches `grades_details.php` and parses the `<select id="course_id">` dropdown to discover all enrolled courses dynamically.

3. **Grade fetching**: For each visible course, the background service worker fetches the course's grade page. The content script parses the HTML table to extract dates, types, descriptions, weights, and grade percentages.

4. **Weighted averages**: Computed as `sum(grade * weight) / sum(weight)`, skipping ungraded entries. The general average is the mean of all subject averages.

5. **Course visibility**: Hidden courses are stored in `chrome.storage.local` under the key `hiddenCourses`. The extension popup provides a checklist to toggle visibility.

## File structure

```
sms-extension/
├── manifest.json          — MV3 WebExtension manifest
├── background.js          — Service worker: fetches SMS pages (raw HTML)
├── content.js             — Content script: parses grades, injects dashboard widget
├── content.css            — Widget styling
├── popup.html             — Extension popup UI
├── popup.js               — Popup logic: course visibility toggles
├── popup.css              — Popup styling
├── icons/                 — Extension icons (16/48/128px)
├── package.json           — Build scripts and dependencies
├── esbuild.config.mjs     — esbuild build configuration
├── scripts/
│   └── generate-icons.mjs — Placeholder icon generator
└── .gitignore
```

## Development

### Prerequisites

- Node.js 18+

### Setup

```sh
cd sms-extension
npm install
```

### Dev build (logging enabled)

```sh
npm run dev
```

Outputs to `dist/` with `DEV=true` (console logging active, inline sourcemaps).

### Production build (logging stripped)

```sh
npm run build
```

Outputs to `dist/` with `DEV=false` (logging no-ops, minified, no sourcemaps).

### Package for distribution

```sh
npm run package
```

Runs the production build and creates `sms-grades-extension.zip` from `dist/`.

### Regenerate icons

```sh
node scripts/generate-icons.mjs
```

## Installation

### Chrome (development)

1. Run `npm run dev`
2. Go to `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `dist/` folder

### Firefox (development)

1. Run `npm run dev`
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** and select `dist/manifest.json`

### Chrome Web Store / Firefox Add-ons

1. Run `npm run package`
2. Upload `sms-grades-extension.zip` to the respective store

## Usage

1. Log into [sms.eursc.eu](https://sms.eursc.eu) as usual
2. Navigate to the dashboard — the grades widget appears at the top
3. Click the extension icon in the toolbar to hide/show specific courses
4. Hidden course preferences persist across sessions

## Technical details

- **Target**: sms.eursc.eu (European Schools student management system)
- **Auth**: SAML 2.0 via ADFS (`sts.eursc.eu`) → Office 365
- **Session**: PHP session (`PHPSESSID` cookie)
- **Grade source**: Server-rendered HTML at `/content/studentui/grades_details.php`
- **Manifest**: V3 (Chrome + Firefox compatible)
- **Permissions**: `activeTab`, `storage`, `host_permissions` for `sms.eursc.eu`

## License

Copyright (c) 2026 KOZELJ Michele. All rights reserved.
