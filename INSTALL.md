# Agentation Workflow — Installation Guide

This guide is designed for both humans and AI coding agents. Follow it step-by-step to add the Agentation visual feedback + auto-fix pipeline to any web project.

---

## Prerequisites

- **Node.js 18+**
- **A coding agent CLI** (at least one must be installed on the machine running the webhook receiver):
  - [OpenAI Codex CLI](https://github.com/openai/codex): `npm i -g @openai/codex` + set `OPENAI_API_KEY`
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview): `npm i -g @anthropic-ai/claude-code` + set `ANTHROPIC_API_KEY`
  - Or any CLI agent — edit `spawnCodingAgent()` in `webhook-receiver.mjs` to use your preferred agent
- **The CLI must be available on the server's PATH** — the webhook receiver spawns it as a child process

> **⚠️ Common issue:** The webhook receiver spawns the agent CLI directly. If `codex` or `claude` isn't installed or isn't on PATH, annotations will be received but nothing will happen. Verify: `which codex` or `which claude`

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

#### Dev-only guard (recommended)

Wrap the `<Agentation>` component in a `NODE_ENV` check so it never ships to production:

```tsx
const isDev = process.env.NODE_ENV !== "production";

return (
  <>
    <YourAppContent />
    {isDev && (
      <Agentation
        key={`agentation-${remountKey}`}
        webhookUrl="http://localhost:4848/webhook"
        autoSend={true}
      />
    )}
  </>
);
```

Next.js, Vite, and CRA all set `NODE_ENV=production` during `npm run build` / `next build`, so the Agentation toolbar and its dependencies will be **tree-shaken out** of production bundles automatically.

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
| `data-auto-reload` | No | `false` | Auto-reload page after resolved annotations (plain HTML helper) |
| `data-auto-reload-delay` | No | `1200` | Delay (ms) before auto-reload |

**Example with all options:**
```html
<script
  src="agentation-vanilla.js"
  data-webhook="http://192.168.1.50:4848/webhook"
  data-sse="http://192.168.1.50:4848/events"
  data-mcp="http://192.168.1.50:4747"
  data-auto-reload="true"
  data-auto-reload-delay="1200"
></script>
```

#### Keeping Agentation out of production (plain HTML)

Since plain HTML has no build step or tree-shaking, you need to ensure the `<script>` tag doesn't ship to production. Options:

**Option 1: Git-ignored include file (recommended)**

Create a separate `agentation-dev.html` snippet and include it via your build/deploy process only in dev:

```html
<!-- agentation-dev.html — add to .gitignore or strip during deploy -->
<script src="agentation-vanilla.js" data-webhook="http://localhost:4848/webhook"></script>
```

**Option 2: Server-side conditional**

If using a templating engine (PHP, Jinja, EJS, etc.):

```html
<% if (process.env.NODE_ENV !== 'production') { %>
  <script src="agentation-vanilla.js" data-webhook="http://localhost:4848/webhook"></script>
<% } %>
```

**Option 3: CI/deploy strip**

Add a step to your deploy pipeline that removes the Agentation script tag:

```bash
sed -i '/<script.*agentation-vanilla/d' index.html
```

**Option 4: Comment marker for easy toggle**

```html
<!-- DEV ONLY: Remove before production deploy -->
<script src="agentation-vanilla.js" data-webhook="http://localhost:4848/webhook"></script>
<!-- /DEV ONLY -->
```

---

## Start the Webhook Receiver

The webhook receiver runs alongside your dev server. It receives annotations, batches them, spawns Codex to fix the code, and broadcasts resolution events.

> **⚠️ CRITICAL: Always start the webhook receiver from your project directory (or set `AGENTATION_PROJECT_DIR`).** The agent uses this path as its working directory. If it points at the wrong project, the agent will edit the wrong files.

**Recommended: run from your project directory (simplest, no env vars needed):**

```bash
cd /your/project
node /path/to/webhook-receiver.mjs
```

**Alternative: set the project directory explicitly:**

```bash
AGENTATION_PROJECT_DIR=/path/to/project node webhook-receiver.mjs
```

**With all options:**

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
| `GET` | `/events` | SSE stream for status/resolution broadcasts |
| `GET` | `/agent` | Get currently selected agent |
| `POST` | `/agent` | Set selected agent |
| `GET` | `/git/status` | Git branch + dirty state |
| `GET` | `/git/recent?limit=10` | List recent commits for revert picker |
| `POST` | `/git/commit` | Commit changes with provided message (optionally push) |
| `POST` | `/git/auto-commit` | Agent-generated commit message + commit (optionally push) |
| `POST` | `/git/revert` | Revert selected commit (optionally push) |
| `POST` | `/test-resolve` | Debug: manually broadcast resolution (`{"ids":["..."]}`) |

---

## How It Works

### Annotation → Fix → Resolve Flow

1. **Human annotates** — Click elements in the browser, add comments describing desired changes
2. **Webhook receives** — Annotations are POSTed to `/webhook`
3. **Batch window** — Waits 10s (configurable) to collect multiple annotations into one task
4. **Agent spawns** — Codex runs in `--full-auto` mode against your project directory
5. **Code changes** — Agent edits source files based on annotation descriptions
6. **Hot reload** — Next.js/Vite auto-reload; plain HTML can use `data-auto-reload="true"` (or refresh manually)
7. **Resolution broadcast** — When agent exits, resolved annotation IDs are sent via SSE
8. **Annotations clear** — Browser removes resolved annotations from localStorage and remounts the toolbar
9. **Session context is preserved** — Future annotations on the same page/agent include prior batch history, so follow-up requests ("undo previous change") keep context

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
| **Agent edits wrong files** | Most common issue! Check `AGENTATION_PROJECT_DIR` or that you started the receiver from the correct directory. Check `last-agent-prompt.md` to see what path the agent received. |
| Annotations don't clear | Is the webhook receiver running the latest code? It doesn't hot-reload — restart after edits. |
| SSE not connecting | `curl -N http://localhost:4848/events` should show `data: connected` |
| Agent not spawning | Check `codex --version` and `OPENAI_API_KEY`. Check `feedback.jsonl` in project dir. |
| "Not found" on /events | Old webhook receiver process running. Kill and restart. |

### Debug: Test Resolution Manually

```bash
curl -X POST http://localhost:4848/test-resolve \
  -H "Content-Type: application/json" \
  -d '{"ids":["ANNOTATION_ID_HERE"]}'
```

Check browser console for `[Agentation] Resolved IDs received:` log.

---

## Remote Feedback via Tailscale

Tailscale lets you expose your dev server and webhook receiver to other devices on your private network — perfect for annotating from your laptop/phone while an AI agent on a remote server fixes the code.

### Setup

1. **Install Tailscale** on both machines (your local device and the dev server):
   - [https://tailscale.com/download](https://tailscale.com/download)

2. **Find your dev server's Tailscale IP**:
   ```bash
   tailscale ip -4
   # Example output: 100.89.253.104
   ```

3. **Bind your dev server to all interfaces** (most frameworks do this with `--host`):
   ```bash
   # Next.js
   next dev --hostname 0.0.0.0

   # Vite
   vite --host 0.0.0.0

   # Plain HTML (Node server)
   npx serve -l 3000 --cors

   # Python
   python3 -m http.server 3000 --bind 0.0.0.0
   ```

4. **Start the webhook receiver** (it already binds to `0.0.0.0`):
   ```bash
   cd /your/project && node webhook-receiver.mjs
   ```

5. **Update URLs to use the Tailscale IP**:

   For React:
   ```tsx
   <Agentation
     webhookUrl="http://100.89.253.104:4848/webhook"
     autoSend={true}
   />
   ```
   And in `agentation-hook.ts`:
   ```typescript
   const SSE_URL = "http://100.89.253.104:4848/events";
   ```

   For plain HTML:
   ```html
   <script
     src="agentation-vanilla.js"
     data-webhook="http://100.89.253.104:4848/webhook"
   ></script>
   ```

6. **Open the page from your local device**:
   ```
   http://100.89.253.104:3000
   ```

### Typical Architecture

```
┌─────────────────────┐         ┌──────────────────────────────────┐
│  Your Laptop/Phone  │         │  Remote Dev Server (Tailscale)   │
│                     │  VPN    │                                  │
│  Browser ──────────────────── │  Dev server (:3000)              │
│  (annotate UI)      │         │  Webhook receiver (:4848)        │
│                     │         │  Codex agent (auto-fix code)     │
│  SSE ← resolved ───────────  │  SSE broadcast on completion     │
└─────────────────────┘         └──────────────────────────────────┘
```

### With OpenClaw

If you're using OpenClaw, the AI agent runs on the remote server and can:
- Receive annotations via the webhook receiver
- Spawn Codex to fix code automatically
- The human only needs a browser — no dev tools on their device

This is ideal for non-technical stakeholders reviewing UI: they annotate on their device, the AI fixes it on the server, and they refresh to see changes.

### Security Notes

- Tailscale traffic is encrypted end-to-end (WireGuard)
- Only devices on your Tailscale network can access the dev server
- The webhook receiver's CORS is set to `*` — this is fine for dev but restrict it if exposing beyond your Tailscale network
- Never expose the webhook receiver to the public internet without authentication
