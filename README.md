# Agentation Workflow

**Visual feedback → AI agent → auto-fix pipeline.**

Drop the `<Agentation>` toolbar into any web page. Annotate UI issues visually. A webhook receiver batches annotations and spawns a coding agent (Codex) to fix them automatically. Resolved annotations are removed from the UI via SSE.

## Architecture

```
Browser (Agentation toolbar)
  │
  ├── Annotation created → POST /webhook (webhook-receiver)
  │                              │
  │                              ├── Batch window (10s)
  │                              ├── Spawn Codex agent
  │                              │     └── Edit source files
  │                              │     └── Hot reload (Next.js/Vite)
  │                              │
  │                              └── On agent exit → broadcast resolved IDs via SSE
  │
  └── SSE listener ← GET /events
        └── Remove resolved annotations from localStorage
        └── Remount <Agentation> component (React key change)
```

## Quick Start

See [INSTALL.md](./INSTALL.md) for full setup guide.

```bash
# 1. Install agentation in your project
npm install agentation

# 2. Copy webhook receiver
cp webhook-receiver.mjs /your/project/

# 3. Add <Agentation> component (see integration example)
# 4. Start webhook receiver
node webhook-receiver.mjs

# 5. Annotate in browser → agent fixes automatically
```

## Files

| File | Purpose |
|------|---------|
| `webhook-receiver.mjs` | HTTP server: receives annotations, batches them, spawns Codex, broadcasts resolution via SSE |
| `integration/page.tsx` | Reference Next.js page with Agentation + SSE completion listener |
| `integration/agentation-hook.ts` | Standalone React hook for annotation resolution (drop into any project) |
| `INSTALL.md` | Full setup and configuration guide |
| `INTERNALS.md` | Agentation library internals reference (localStorage keys, API endpoints, data model) |

## Requirements

- Node.js 18+
- [Codex CLI](https://github.com/openai/codex) (`npm i -g @openai/codex`)
- OpenAI API key (for Codex agent)
- Optional: Agentation MCP server (`npx agentation serve`)
