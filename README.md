# Cliptor

**macOS Menu Bar Clipboard History Utility**

Cliptor lives in your macOS menu bar, monitors your clipboard for changes, and maintains a searchable history of everything you copy. Browse, search, and auto-paste previous entries with keyboard shortcuts — no mouse required.

## Features

- **Menu bar operation** — runs silently in the menu bar with no dock icon
- **Clipboard monitoring** — polls every 800ms and captures text changes automatically
- **Persistent history** — stores up to 50 items in `history.json`, survives app restarts
- **Search/filter** — real-time case-insensitive filtering as you type
- **Keyboard navigation** — arrow keys, Enter, Escape, and `⌘1`–`⌘9` quick-select shortcuts
- **Auto-paste** — selects an item and simulates `⌘V` via AppleScript into your previously active app
- **OG link previews** — fetches Open Graph data (title, description, image) for pasted URLs
- **Detail preview** — long-press any item to open a full-content preview window
- **Delete / Clear** — remove individual items or wipe the entire history
- **Dev hot-reload** — `npm run dev` enables automatic reload on file changes via chokidar

## Installation

```sh
git clone https://github.com/1IN1B/cliptor.git
cd cliptor
npm install
npm start
```

## Usage

1. Click the Cliptor icon in the macOS menu bar to open the popup.
2. Browse your clipboard history or start typing to filter.
3. Press `Enter` (or click) on an item to copy it and auto-paste it into your active app.
4. Press `⌘1`–`⌘9` to quickly select items by position.
5. Hold the mouse button on an item for 500ms to open a detail preview.
6. Press `Escape` to close the popup.

## Architecture

```
src/
├── main.js        # Electron main process
├── preload.js     # Context bridge (secure IPC)
├── renderer.js    # Popup UI logic
├── index.html     # Popup window markup
├── index.css      # Popup window styles
├── preview.html   # Detail preview markup
└── preview.css    # Detail preview styles
assets/
├── trayIconTemplate.png    # Menu bar icon
└── trayIconTemplate@2x.png # Retina menu bar icon
```

- **Main process** (`main.js`) — manages the tray icon, polls the clipboard, persists history, fetches OG data for URLs, handles all IPC, and controls the preview window.
- **Renderer** (`renderer.js` + `index.html` + `index.css`) — glassmorphism UI with aurora borealis animations, keyboard navigation, search, and mouse interactions.
- **Preload** (`preload.js`) — exposes a secure, whitelisted API via `contextBridge` with `contextIsolation` enabled and `nodeIntegration` disabled.
- **Preview window** (`preview.html` + `preview.css`) — separate overlay for viewing full item content and OG link previews.

## Tech Stack

- **Electron 28** — desktop framework
- **Vanilla JavaScript** — no frontend frameworks
- **macOS native APIs** — Tray, vibrancy (`under-window`), template icons, AppleScript automation
- **Chokidar** — dev-mode file watching for hot reload

## Development

```sh
npm run dev
```

Starts the app with `--dev` flag, enabling chokidar file watchers. Changes to `index.html`, `index.css`, or `renderer.js` trigger a window reload. Changes to `main.js` or `preload.js` trigger a full app relaunch.

## License

MIT
