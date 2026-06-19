<div align="center">
  <h1>Noted</h1>
  <p><strong>Local-first, privacy-respecting block note-taking app</strong></p>
  <p>Runs entirely in your browser. No cloud. No accounts. No trackers.</p>
</div>

---

## Features

- **Block Editor** — Notion-style editing with slash commands, markdown shortcuts, emoji picker
- **Local Filesystem Access** — Open & edit real files on disk via the File System Access API
- **Simulated Sandbox** — Fully functional demo mode when filesystem API is unavailable (e.g., inside iframes)
- **Multi-format Support** — Markdown (`.md`), plaintext (`.txt`, `.json`), PDF viewer, DOC/DOCX viewer
- **File Tree Sidebar** — Browse, search, create, rename, delete files and folders
- **Auto-save** — Debounced saving to disk or localStorage
- **Light/Dark Theme** — Toggleable dark mode
- **100% Offline** — No backend server, no user accounts, no telemetry

## Quick Start

```sh
npm install
npm run dev
```

Open `http://localhost:3000`. No API keys or configuration needed.

> **Note:** Markdown hot-reload may be disabled by default. Set `DISABLE_HMR=false` in your environment to enable it.

## Usage

| Mode | Description |
|------|-------------|
| **Simulated Sandbox** | Preloaded demo workspace with sample files in browser localStorage |
| **Local Folder** | Click "Open Folder" to mount a real directory from your machine |

When running inside an iframe (e.g., AI Studio preview), the File System Access API is blocked by browser security. Use the "Go Native in a Full Tab" option for full filesystem access.

## Tech Stack

| Tool | Purpose |
|------|---------|
| React 19 + TypeScript | UI framework |
| Vite 6 | Bundler |
| BlockNote | Block-based editor |
| Zustand | State management |
| Tailwind CSS v4 | Styling |
| Lucide React | Icons |
| File System Access API | Local disk read/write |

## Project Structure

```
src/
├── App.tsx                 # Main app shell
├── components/
│   ├── Sidebar.tsx         # File tree + navigation
│   ├── NoteEditor.tsx      # BlockNote editor (markdown)
│   ├── PlaintextEditor.tsx # Plaintext/code editor
│   └── DocumentViewer.tsx  # PDF/DOC viewer
└── store/
    └── noteStore.ts        # Zustand state + file operations
```

## License

MIT
