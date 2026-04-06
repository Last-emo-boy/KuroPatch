<h1 align="center">🔧 KuroPatch</h1>

<p align="center">
  <strong>AI-powered browser debugging & visual editing Chrome extension</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-Manifest%20v3-4285F4?logo=googlechrome&logoColor=white" alt="Chrome MV3" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white" alt="Vite 6" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" />
</p>

<p align="center">
  An AI debugger that doesn't just give advice — it <strong>fixes things in real-time</strong>.<br/>
  Inspect elements, modify DOM, inject CSS/JS, capture network, automate workflows — all through natural language.
</p>

---

## ✨ Features

### 🤖 AI-Powered Chat Interface
Conversational AI that directly operates on web pages through **29 built-in tools**. Supports Anthropic Claude, OpenAI GPT-4, and any OpenAI-compatible API.

### 🔧 29 AI Tools
| Category | Tools |
|----------|-------|
| **Inspection** | `inspect_element` · `get_page_sections` · `read_text` · `check_exists` · `check_text_contains` · `get_page_info` · `get_console_logs` · `get_network_requests` |
| **Visual Editing** | `modify_style` · `inject_css` · `hide_element` · `show_element` · `remove_element` · `clone_element` |
| **Content** | `modify_text` · `modify_attribute` · `modify_html` |
| **Automation** | `click` · `type_text` · `select_option` · `keypress` · `scroll_to` · `wait_for` · `start_hooks` |
| **Advanced** | `inject_js` (execute arbitrary JavaScript in page context) |
| **Script Persistence** | `save_script` · `update_script` · `run_script` · `list_scripts` |

### 📜 Persistent Scripts (Action & Toggle Modes)
Save reusable scripts that survive page reloads:

| Mode | Behavior | Example |
|------|----------|---------|
| **⚡ Action** | One-shot execution | Download video, scrape data, auto-fill form |
| **◐ Toggle** | On/off persistent effect | Hide ads, inject custom CSS, dark mode override |

Scripts support three trigger types:
- **Manual** — click to run
- **Auto** — runs on every page load
- **URL Match** — runs only on matching URLs (glob patterns like `*://*.example.com/*`)

### 🔍 Element Inspector
Visual element picker with detailed inspection — computed styles, box model, DOM path, children/siblings, event listeners.

### 📡 Network Monitor
Real-time HTTP request capture via Chrome DevTools Protocol — method, URL, status, headers, timing, failed requests.

### 🎣 Event Hooks
Monitor page runtime events — fetch/XHR interception, console logs, JS errors, DOM mutations, script injections, navigation.

### 🩹 Patch Tracking
History of all AI modifications with one-click rollback capability.

### 💾 Session Management
Multiple chat conversations with auto-save and restore.

---

## 📸 Screenshots

> *Coming soon — the extension runs in Chrome's side panel. There will be one bro*

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) 18+
- [Google Chrome](https://www.google.com/chrome/) (or Chromium-based browser)

### Install & Build

```bash
git clone https://github.com/Last-emo-boy/KuroPatch.git
cd KuroPatch
npm install
npm run build
```

### Load into Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder
5. Click the KuroPatch icon in the toolbar to open the side panel

### Configure AI Provider

1. Open the side panel → click ⚙️ Settings
2. Choose your AI provider:
   - **Anthropic** — paste your API key, select a Claude model
   - **OpenAI** — paste your API key, select GPT-4o / GPT-4-turbo
   - **OpenAI-Compatible** — set custom endpoint URL + API key
3. Click Save

> **Note**: You need your own API key. The extension calls the AI API directly from your browser — no backend server, no data collection.

---

## 📖 Usage Examples

### Hide an element
```
"Hide the hot search section on this page"
```
The AI will inspect the page, find the element, and use `hide_element` or `inject_css` to remove it.

### Save a persistent script
```
"Hide all ads on this page and save as a toggle script"
```
Creates a reusable CSS script you can toggle on/off from the Scripts panel.

### Debug a page
```
"Check the console for errors and inspect any failing network requests"
```
AI will use `get_console_logs` + `get_network_requests` to diagnose issues.

### Automate interactions
```
"Fill in the login form with test@example.com / password123 and click submit"
```
Uses `type_text` and `click` tools to automate form submission.

### Inject custom JavaScript
```
"Count all images on this page and log their src attributes"
```
AI uses `inject_js` to run custom code in page context.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Chrome Extension (MV3)                      │
│                                                                │
│  ┌─────────────────┐         ┌──────────────────────────┐    │
│  │ Side Panel (React)│◄──────►│ Background Service Worker │    │
│  │                   │  msg   │                          │    │
│  │ • Chat UI         │        │ • Message routing        │    │
│  │ • Scripts panel   │        │ • Network capture        │    │
│  │ • Inspect panel   │        │ • Patch management       │    │
│  │ • Network monitor │        │ • Storage operations     │    │
│  │ • Settings        │        │ • Auto content-script    │    │
│  │ • AI tool executor│        │   injection fallback     │    │
│  └─────────────────┘         └────────────┬─────────────┘    │
│                                            │                   │
│                              chrome.tabs.sendMessage()         │
│                                            │                   │
│                               ┌────────────▼─────────────┐   │
│                               │ Content Script            │   │
│                               │                           │   │
│                               │ • DOM read/write          │   │
│                               │ • Element inspection      │   │
│                               │ • Section detection       │   │
│                               │ • CSS/JS injection        │   │
│                               │ • Automation (click/type) │   │
│                               │ • Patch apply/rollback    │   │
│                               └────────────┬─────────────┘   │
│                                            │ postMessage()     │
│                               ┌────────────▼─────────────┐   │
│                               │ Injected Script           │   │
│                               │ (runs in page context)    │   │
│                               │                           │   │
│                               │ • Fetch/XHR interception  │   │
│                               │ • Console monitoring      │   │
│                               │ • Error tracking          │   │
│                               │ • DOM mutation observer    │   │
│                               │ • Script injection detect │   │
│                               └───────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### Message Flow

1. User sends a message in Chat
2. Side panel gathers page context (URL, DOM summary, sections, console logs, errors)
3. Builds dynamic system prompt with page state
4. Calls AI provider API with system prompt + 29 tool definitions
5. AI returns text + tool calls → side panel executes each tool
6. Tool execution routes through background → content script → page
7. Results sent back to AI for next iteration (up to 10 loops)
8. Final response displayed in chat

---

## 📁 Project Structure

```
KuroPatch/
├── public/
│   └── manifest.json              # Chrome MV3 manifest
├── src/
│   ├── background/
│   │   └── index.ts               # Service worker — message routing, network capture
│   ├── content/
│   │   └── index.ts               # Content script — DOM bridge, element inspection
│   ├── injected/
│   │   └── hooks.ts               # Page-context script — fetch/XHR/console hooks
│   ├── shared/
│   │   ├── messaging.ts           # Message type definitions
│   │   ├── storage.ts             # Chrome storage wrapper (config, scripts, sessions)
│   │   ├── tools.ts               # 29 AI tool definitions (names, params, descriptions)
│   │   └── types.ts               # All shared TypeScript interfaces
│   └── sidepanel/
│       ├── App.tsx                 # Main app — view routing between 9 panels
│       ├── main.tsx                # React entry point
│       ├── components/
│       │   ├── Chat.tsx            # AI chat interface + system prompt builder
│       │   ├── Scripts.tsx         # Script manager (action/toggle, run, edit)
│       │   ├── Inspect.tsx         # Element inspector + visual picker
│       │   ├── Network.tsx         # Network request monitor
│       │   ├── Hooks.tsx           # Page event monitor
│       │   ├── Patches.tsx         # Modification history + rollback
│       │   ├── Flows.tsx           # Automation workflow builder
│       │   ├── Sessions.tsx        # Chat session manager
│       │   └── Settings.tsx        # AI provider configuration
│       ├── services/
│       │   ├── ai.ts              # AI API adapter (Anthropic / OpenAI)
│       │   ├── page.ts            # Page context retrieval
│       │   └── tools.ts           # Tool execution bridge
│       └── styles/
│           └── globals.css         # All styles (dark theme)
├── scripts/
│   ├── gen-icons.mjs              # Icon generation
│   └── post-build.mjs             # Post-build processing
├── vite.config.ts                 # Multi-target Vite config
├── tsconfig.json
└── package.json
```

---

## 🛠️ Development

### Build Commands

```bash
npm run build              # Full clean build (all 4 targets)
npm run build:sidepanel    # React side panel only
npm run build:background   # Background service worker only
npm run build:content      # Content script only
npm run build:injected     # Injected hooks script only
npm run clean              # Remove dist/
```

### Build Targets

| Target | Output | Format |
|--------|--------|--------|
| `sidepanel` | `dist/sidepanel/` | React SPA (Vite HTML entry) |
| `background` | `dist/background.js` | IIFE |
| `content` | `dist/content.js` | IIFE |
| `injected` | `dist/injected.js` | IIFE |

### Making Changes

1. Edit source files in `src/`
2. Run `npm run build`
3. Go to `chrome://extensions/` → click the **reload ↻** button on KuroPatch
4. Refresh the target page

> **Tip**: Keep the service worker console open (click "service worker" on the extensions page) to see debug logs. Enable debug mode in Settings for verbose logging.

---

## 🔒 Privacy & Security

- **No backend server** — AI API calls are made directly from your browser
- **No data collection** — your API key and conversations stay in local Chrome storage
- **Open source** — inspect every line of code yourself
- **Permissions are scoped**: `activeTab` for current tab only, `debugger` for network capture, `scripting` for content script injection

---

## ⚙️ Supported AI Providers

| Provider | Models | Notes |
|----------|--------|-------|
| **Anthropic** | Claude Sonnet 4, Claude 3.5 Sonnet, Claude 3.5 Haiku | Recommended — best tool-use performance |
| **OpenAI** | GPT-4o, GPT-4o-mini, GPT-4-turbo | Good alternative |
| **OpenAI-Compatible** | Any model behind OpenAI-format API | For self-hosted / third-party endpoints |

---

## 🤝 Contributing

Contributions are welcome! Feel free to:

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/new-tool`)
3. Make your changes
4. Build and test (`npm run build`, load in Chrome)
5. Submit a PR

### Ideas for Contributions
- New AI tools (e.g., screenshot capture, accessibility audit)
- More automation actions (drag & drop, file upload)
- UI themes / localization
- Test suite

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
