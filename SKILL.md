---
name: agentation-workflow
description: "Add visual feedback → AI auto-fix pipeline to any web app. Installs the Agentation toolbar (click elements, annotate UI issues) with a webhook receiver that batches annotations and spawns a coding agent to fix them. Supports React/Next.js/Vite and plain HTML. Use when: setting up visual feedback tooling, adding annotation-driven UI fixes, or integrating Agentation into a web project."
compatibility: "Requires Node.js 18+ and codex CLI (npm i -g @openai/codex). Works on any OS."
metadata:
  { "openclaw": { "emoji": "🎯", "requires": { "anyBins": ["codex", "claude"] } }, "author": "dkclaw", "version": "1.0" }
---

# Agentation Workflow

Visual feedback → AI agent → auto-fix pipeline. A human annotates UI issues in the browser, a coding agent fixes them automatically, and resolved annotations clear from the UI.

## When to Use

- User wants to add visual feedback/annotation tooling to a web app
- User wants AI agents to auto-fix UI issues based on visual annotations
- User mentions "agentation", "visual feedback", "annotate UI", or "annotation-driven fixes"

## Quick Install

### Step 1: Start the Webhook Receiver

Copy `{baseDir}/webhook-receiver.mjs` to the target project, then start it **from the project directory**:

```bash
cd /path/to/project
node /path/to/webhook-receiver.mjs
```

> ⚠️ The webhook receiver uses `process.cwd()` as the project directory. Always `cd` into the project first, or set `AGENTATION_PROJECT_DIR=/path/to/project`.

### Step 2a: React / Next.js / Vite

```bash
npm install agentation
```

Copy `{baseDir}/integration/agentation-hook.ts` into the project source directory.

Add to the target page:

```tsx
"use client"; // Next.js only

import { useState, useCallback } from "react";
import { Agentation } from "agentation";
import { useCompletionListener } from "./agentation-hook";

export default function Page() {
  const [remountKey, setRemountKey] = useState(0);
  const handleResolved = useCallback(() => setRemountKey((k) => k + 1), []);
  useCompletionListener(handleResolved);

  return (
    <>
      {/* existing page content */}
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
- `key={...remountKey}` is required — forces remount on resolution to clear annotations
- Wrap in `process.env.NODE_ENV !== "production"` check so it's tree-shaken from prod builds
- Update `webhookUrl` if the webhook receiver is on a different host/port
- Update `SSE_URL` in `agentation-hook.ts` to match

**Dev-only guard (important):**
```tsx
const isDev = process.env.NODE_ENV !== "production";
// ... in JSX:
{isDev && <Agentation key={...} webhookUrl="..." autoSend={true} />}
```

### Step 2b: Plain HTML (no build step)

Copy `{baseDir}/integration/agentation-vanilla.js` to the project directory.

Add before `</body>`:

```html
<script
  src="agentation-vanilla.js"
  data-webhook="http://localhost:4848/webhook"
></script>
```

No npm install needed. Loads React + Agentation from CDN automatically.

**Important:** Remove this `<script>` tag before deploying to production. See [INSTALL.md]({baseDir}/INSTALL.md) for strategies (git-ignore, CI strip, server-side conditional).

## How It Works

1. Human clicks elements in browser → adds annotation comments
2. Annotations POST to webhook receiver (`/webhook`)
3. 10-second batch window collects multiple annotations
4. Codex agent spawns in `--full-auto` mode, edits source files
5. On agent exit → resolved annotation IDs broadcast via SSE (`/events`)
6. Browser removes resolved annotations from localStorage, remounts toolbar

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `AGENTATION_PROJECT_DIR` | `process.cwd()` | Project root for the coding agent |
| `AGENTATION_PORT` | `4848` | Webhook + SSE port |
| `AGENTATION_BATCH_MS` | `10000` | Batch window before spawning agent |

## Webhook Receiver Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhook` | Receives annotation events |
| `GET` | `/events` | SSE stream for resolution broadcasts |
| `POST` | `/test-resolve` | Debug: manually broadcast resolution |

## Troubleshooting

- **Agent edits wrong files**: Check `AGENTATION_PROJECT_DIR` or that you started from the correct directory
- **Annotations don't clear**: Restart the webhook receiver (it doesn't hot-reload)
- **SSE not connecting**: `curl -N http://localhost:4848/events` should show `data: connected`

## Reference Files

- See [INSTALL.md]({baseDir}/INSTALL.md) for detailed setup guide
- See [INTERNALS.md]({baseDir}/INTERNALS.md) for Agentation library internals (localStorage schema, API endpoints, data model)
