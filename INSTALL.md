# Installation & Configuration Guide

## Prerequisites

- Node.js 18+
- A web project with React (Next.js, Vite, CRA, etc.)
- [Codex CLI](https://github.com/openai/codex) installed globally: `npm i -g @openai/codex`
- OpenAI API key set: `export OPENAI_API_KEY=sk-...`

## Step 1: Install Agentation

```bash
cd /your/project
npm install agentation
```

## Step 2: Add the Webhook Receiver

Copy `webhook-receiver.mjs` to your project root:

```bash
cp /path/to/agentation-workflow/webhook-receiver.mjs ./
```

### Configure

Edit the constants at the top of `webhook-receiver.mjs`:

```javascript
const PORT = 4848;                    // Webhook receiver port
const PROJECT_DIR = "/your/project";  // Absolute path to your project
const BATCH_WINDOW_MS = 10_000;       // Seconds to batch annotations before spawning agent
```

The `PROJECT_DIR` must be an absolute path — Codex runs with this as its working directory.

### Start

```bash
node webhook-receiver.mjs
```

For production, use pm2 or a systemd service:

```bash
pm2 start webhook-receiver.mjs --name agentation-webhook
```

## Step 3: Add Agentation to Your Page

### Option A: Full Integration (Next.js example)

See `integration/page.tsx` for a complete reference. Key parts:

```tsx
"use client";
import { useState, useCallback } from "react";
import { Agentation } from "agentation";
import { useCompletionListener } from "./agentation-hook";

export default function Page() {
  const [remountKey, setRemountKey] = useState(0);
  const handleResolved = useCallback(() => setRemountKey((k) => k + 1), []);
  useCompletionListener(handleResolved);

  return (
    <>
      {/* Your page content */}
      <Agentation
        key={`agentation-${remountKey}`}
        webhookUrl="http://YOUR_SERVER:4848/webhook"
        autoSend={true}
      />
    </>
  );
}
```

### Option B: Minimal Integration

```tsx
import { Agentation } from "agentation";

// Just the toolbar — no auto-resolution
<Agentation
  webhookUrl="http://YOUR_SERVER:4848/webhook"
  autoSend={true}
/>
```

### Option C: With MCP Server (Full Sync)

```bash
# Start MCP server (optional — enables server-side annotation storage)
npx agentation serve --port 4747
```

```tsx
<Agentation
  key={`agentation-${remountKey}`}
  webhookUrl="http://YOUR_SERVER:4848/webhook"
  mcpUrl="http://YOUR_SERVER:4747"
  autoSend={true}
/>
```

## Step 4: Configure the Completion Hook

Copy `integration/agentation-hook.ts` to your project. Update the SSE URL:

```typescript
const SSE_URL = "http://YOUR_SERVER:4848/events";
```

This hook:
1. Connects to the webhook receiver's SSE endpoint
2. Listens for `resolved` events (sent when Codex finishes)
3. Removes resolved annotations from `localStorage`
4. Calls `onResolved()` to bump the Agentation component's key → forces remount

## Step 5: Verify the Pipeline

1. Open your app in the browser
2. Click the Agentation toolbar (bottom-right)
3. Click on a UI element and add an annotation (e.g., "make this text red")
4. Wait for the batch window (default 10s)
5. Watch the terminal — Codex should spawn and make changes
6. Hot reload shows the fix; annotations should auto-clear

## Configuration Reference

### Webhook Receiver (`webhook-receiver.mjs`)

| Constant | Default | Description |
|----------|---------|-------------|
| `PORT` | `4848` | HTTP port for webhook + SSE |
| `PROJECT_DIR` | (must set) | Absolute path to your project root |
| `BATCH_WINDOW_MS` | `10000` | Ms to wait before batching annotations into one agent task |

### Agentation Component Props

| Prop | Type | Description |
|------|------|-------------|
| `webhookUrl` | `string` | URL of webhook receiver (`http://host:4848/webhook`) |
| `mcpUrl` | `string?` | Optional MCP server URL for server-side annotation sync |
| `autoSend` | `boolean` | Auto-send annotations to webhook on creation |
| `onAnnotationAdd` | `(ann) => void` | Callback when annotation is created |
| `onAnnotationDelete` | `(ann) => void` | Callback when annotation is manually deleted |
| `onCopy` | `(output, anns) => void` | Callback when annotations are copied |

### SSE Events

The webhook receiver sends Server-Sent Events on `GET /events`:

```
data: connected                              // Initial connection
data: {"type":"resolved","ids":["123","456"]} // Annotations resolved by agent
```

## Networking Notes

- The webhook receiver binds to `0.0.0.0` — accessible from any network interface
- For remote access (e.g., Tailscale), use the machine's IP in `webhookUrl` and `SSE_URL`
- CORS is set to `*` by default — restrict in production
- If running behind a reverse proxy, ensure SSE connections are not buffered

## Customizing the Agent

The default agent is Codex in `--full-auto` mode. To use a different agent, edit the `spawnCodingAgent()` function in `webhook-receiver.mjs`.

### Using Claude Code instead:

```javascript
const agent = spawn("claude", ["-p", prompt, "--allowedTools", "Edit,Write,Read"], {
  cwd: PROJECT_DIR,
  stdio: "pipe",
});
```

### Using OpenClaw sub-agents:

Replace `spawnCodingAgent()` with a call to `openclaw` CLI or the OpenClaw sessions API.

## Troubleshooting

### Annotations not clearing after agent finishes

1. **Check webhook receiver is running the latest code** — it doesn't hot-reload. Restart after edits.
2. **Check SSE connectivity**: `curl -N http://localhost:4848/events` should show `data: connected`
3. **Check browser console** for `[Agentation] Resolved IDs received:` logs
4. **Check webhook receiver logs** for `Broadcasting resolution for N annotation(s)`

### Agent not spawning

1. Verify Codex is installed: `codex --version`
2. Check `OPENAI_API_KEY` is set in the webhook receiver's environment
3. Check `feedback.jsonl` in the project dir for received annotations

### SSE connection drops

- EventSource auto-reconnects by default
- Check for reverse proxy/firewall killing long-lived connections
- The hook logs `[Agentation] SSE connection error, will retry...` on errors
