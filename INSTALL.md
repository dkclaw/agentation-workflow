# Agentation Workflow — Installation Guide

This guide is designed for both humans and AI coding agents. Follow it step-by-step to add the Agentation visual feedback + auto-fix pipeline to any web project.

---

## Prerequisites

- Node.js 18+
- [Codex CLI](https://github.com/openai/codex): `npm i -g @openai/codex`
- `OPENAI_API_KEY` set in environment

---

## Choose Your Integration

### Option A: React / Next.js / Vite (recommended for React apps)

#### 1. Install the package

```bash
npm install agentation
```

#### 2. Copy the completion hook

Copy `integration/agentation-hook.ts` into your project's source directory.

Update the `SSE_URL` constant if your webhook receiver runs on a different host/port:

```typescript
const SSE_URL = "http://localhost:4848/events";
```

#### 3. Add Agentation to your page

```tsx
"use client"; // Next.js only

import { useState, useCallback } from "react";
import { Agentation } from "agentation";
import { useCompletionListener } from "./agentation-hook";

export default function MyPage() {
  // Changing this key forces <Agentation> to remount → re-read localStorage
  const [remountKey, setRemountKey] = useState(0);
  const handleResolved = useCallback(() => setRemountKey((k) => k + 1), []);
  useCompletionListener(handleResolved);

  return (
    <>
      {/* Your existing page content — unchanged */}
      <YourAppContent />

      {/* Add this at the end */}
      <Agentation
        key={`agentation-${remountKey}`}
        webhookUrl="http://localhost:4848/webhook"
        autoSend={true}
      />
    </>
  );
}
```

**Key points:**
- `key={...remountKey}` is required — this is how resolved annotations disappear
- `webhookUrl` must point to your running webhook receiver
- `autoSend={true}` sends annotations to the webhook automatically
- Replace `localhost` with your server's IP if accessing remotely

---

### Option B: Plain HTML (no build step)

#### 1. Copy `agentation-vanilla.js` to your project

#### 2. Add one script tag before `</body>`

```html
<script
  src="agentation-vanilla.js"
  data-webhook="http://localhost:4848/webhook"
></script>
```

That's it. The script loads React + Agentation from CDN automatically.

#### Configuration via data attributes

| Attribute | Required | Default | Description |
|-----------|----------|---------|-------------|
| `data-webhook` | Yes | — | Webhook receiver URL |
| `data-sse` | No | Derived from webhook URL | SSE endpoint for auto-resolution |
| `data-mcp` | No | — | MCP server URL (optional) |
| `data-auto-send` | No | `true` | Auto-send annotations |

**Example with all options:**
```html
<script
  src="agentation-vanilla.js"
  data-webhook="http://192.168.1.50:4848/webhook"
  data-sse="http://192.168.1.50:4848/events"
  data-mcp="http://192.168.1.50:4747"
></script>
```

---

## Start the Webhook Receiver

The webhook receiver runs alongside your dev server. It receives annotations, batches them, spawns Codex to fix the code, and broadcasts resolution events.

```bash
# From your project directory:
node /path/to/webhook-receiver.mjs
```

Or with environment variables:

```bash
AGENTATION_PROJECT_DIR=/path/to/project \
AGENTATION_PORT=4848 \
AGENTATION_BATCH_MS=10000 \
node webhook-receiver.mjs
```

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `AGENTATION_PROJECT_DIR` | `process.cwd()` | Project root (Codex working directory) |
| `AGENTATION_PORT` | `4848` | HTTP port for webhook + SSE |
| `AGENTATION_BATCH_MS` | `10000` | Ms to batch annotations before spawning agent |

The receiver auto-detects project type (Next.js, Vite, or static HTML) and adjusts the Codex prompt accordingly.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhook` | Receives annotation events from Agentation |
| `GET` | `/events` | SSE stream for resolution broadcasts |
| `POST` | `/test-resolve` | Debug: manually broadcast resolution (`{"ids":["..."]}`) |

---

## How It Works

### Annotation → Fix → Resolve Flow

1. **Human annotates** — Click elements in the browser, add comments describing desired changes
2. **Webhook receives** — Annotations are POSTed to `/webhook`
3. **Batch window** — Waits 10s (configurable) to collect multiple annotations into one task
4. **Agent spawns** — Codex runs in `--full-auto` mode against your project directory
5. **Code changes** — Agent edits source files based on annotation descriptions
6. **Hot reload** — Next.js/Vite auto-reload; plain HTML requires manual refresh
7. **Resolution broadcast** — When agent exits, resolved annotation IDs are sent via SSE
8. **Annotations clear** — Browser removes resolved annotations from localStorage and remounts the toolbar

### Why the Remount?

Agentation stores annotations in `localStorage` (key: `feedback-annotations-{pathname}`). The component reads from localStorage on mount. There is no public API to programmatically remove annotations. The solution:

1. SSE event arrives with resolved IDs
2. JavaScript removes those IDs from localStorage
3. The React `key` prop changes, forcing unmount → remount
4. Component re-reads localStorage on mount → resolved annotations are gone

---

## Customizing the Agent

Edit `spawnCodingAgent()` in `webhook-receiver.mjs` to use a different agent:

### Claude Code
```javascript
const agent = spawn("claude", ["-p", prompt, "--allowedTools", "Edit,Write,Read"], {
  cwd: PROJECT_DIR, stdio: "pipe",
});
```

### Custom prompt
Modify the `prompt` template string in `spawnCodingAgent()`. The `feedbackBlock` variable contains the formatted annotation data.

---

## Troubleshooting

| Problem | Check |
|---------|-------|
| Annotations don't clear | Is the webhook receiver running the latest code? It doesn't hot-reload — restart after edits. |
| SSE not connecting | `curl -N http://localhost:4848/events` should show `data: connected` |
| Agent not spawning | Check `codex --version` and `OPENAI_API_KEY`. Check `feedback.jsonl` in project dir. |
| Wrong files edited | Check `last-agent-prompt.md` in project dir to see what the agent received. |
| "Not found" on /events | Old webhook receiver process running. Kill and restart. |

### Debug: Test Resolution Manually

```bash
curl -X POST http://localhost:4848/test-resolve \
  -H "Content-Type: application/json" \
  -d '{"ids":["ANNOTATION_ID_HERE"]}'
```

Check browser console for `[Agentation] Resolved IDs received:` log.
