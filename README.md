# Agentation Workflow

**Visual feedback → AI agent → auto-fix pipeline.**

Drop the Agentation toolbar into any web page. A human annotates UI issues visually. A webhook receiver batches annotations and spawns a coding agent (Codex) to fix them. Resolved annotations auto-clear from the UI.

Works with **React/Next.js/Vite** apps and **plain HTML** pages.

## Architecture

```
Browser (Agentation toolbar)
  │
  ├── Annotation created → POST /webhook (webhook-receiver)
  │                              │
  │                              ├── Batch window (10s)
  │                              ├── Spawn Codex agent
  │                              │     └── Edit source files
  │                              │     └── Hot reload / manual refresh
  │                              │
  │                              └── On agent exit → broadcast resolved IDs via SSE
  │
  └── SSE listener ← GET /events
        └── Remove resolved annotations from localStorage
        └── Remount toolbar (annotations gone)
```

## Quick Start

### For AI Agents / Automated Setup

See [INSTALL.md](./INSTALL.md) — step-by-step instructions designed for AI coding agents to follow when integrating into any project.

### Manual

```bash
# 1. Copy webhook-receiver.mjs to your project
# 2. Start it (uses cwd as project dir by default)
cd /your/project && node /path/to/webhook-receiver.mjs

# 3a. React: npm install agentation, add <Agentation> component (see integration/)
# 3b. Plain HTML: add one <script> tag (see integration/agentation-vanilla.js)
```

## Files

| File | Purpose |
|------|---------|
| `webhook-receiver.mjs` | Receives annotations, batches, spawns Codex, broadcasts resolution via SSE |
| `integration/agentation-hook.ts` | React hook for auto-resolution (SSE + localStorage cleanup + remount) |
| `integration/page.tsx` | Minimal React/Next.js example |
| `integration/agentation-vanilla.js` | Single `<script>` tag for plain HTML pages (loads React from CDN) |
| `integration/example.html` | Plain HTML example |
| `INSTALL.md` | Agent-friendly installation guide |
| `INTERNALS.md` | Agentation library internals (localStorage schema, API, data model) |

## Requirements

- Node.js 18+
- [Codex CLI](https://github.com/openai/codex) (`npm i -g @openai/codex`)
- `OPENAI_API_KEY` environment variable
