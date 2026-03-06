import http from "node:http";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";

const PORT = 4848;
const PROJECT_DIR = "/tmp/demos-test";
const BATCH_WINDOW_MS = 10_000; // Wait 10s to batch annotations

let pendingAnnotations = [];
let batchTimer = null;

function broadcastResolved(annotations) {
  const ids = annotations.map((a) => a.id?.toString()).filter(Boolean);
  const event = JSON.stringify({ type: "resolved", ids });
  console.log(`  Broadcasting resolved to ${sseClients.size} client(s): ${ids.join(", ")}`);
  for (const client of sseClients) {
    client.write(`data: ${event}\n\n`);
  }
}

async function resolveAnnotations(annotations) {
  broadcastResolved(annotations);
}

function spawnCodingAgent(annotations) {
  const feedbackBlock = annotations
    .map((a, i) => {
      return `### Annotation ${i + 1}
- **Element:** ${a.element}
- **CSS Path:** ${a.elementPath}
- **React Components:** ${a.reactComponents || "n/a"}
- **Comment:** ${a.comment}
- **Current Styles:** ${a.computedStyles || "n/a"}
- **CSS Classes:** ${a.cssClasses || "n/a"}
- **Selected Text:** ${a.selectedText || "n/a"}`;
    })
    .join("\n\n");

  const prompt = `You are fixing UI issues based on visual feedback annotations from a human reviewer.

The project is a Next.js app in ${PROJECT_DIR}. The main page component is at app/page.tsx.

## Feedback to address:

${feedbackBlock}

## Instructions:
- Fix each annotation by editing the relevant files
- Keep changes minimal and focused on what was requested
- Do NOT modify the Agentation component or webhook setup
- After making changes, the Next.js dev server will hot-reload automatically

When completely finished, run this command to notify me:
openclaw system event --text "Done: Fixed ${annotations.length} UI annotation(s) from Agentation feedback" --mode now`;

  console.log(`\n[${new Date().toISOString()}] Spawning Codex agent for ${annotations.length} annotation(s)...`);

  // Log the prompt for debugging
  fs.writeFileSync(`${PROJECT_DIR}/last-agent-prompt.md`, prompt);

  const agent = spawn("codex", ["--full-auto", "exec", prompt], {
    cwd: PROJECT_DIR,
    stdio: "pipe",  // Use pipe so we can log output
    env: { ...process.env, PATH: process.env.PATH },
  });

  // Log agent stdout/stderr
  agent.stdout?.on("data", (d) => process.stdout.write(`[codex] ${d}`));
  agent.stderr?.on("data", (d) => process.stderr.write(`[codex:err] ${d}`));

  agent.on("error", (err) => {
    console.error(`Agent spawn error: ${err.message}`);
  });

  agent.on("exit", (code) => {
    console.log(`\n[${new Date().toISOString()}] Codex agent exited with code ${code}`);
    // Resolve annotations regardless of exit code — the changes were likely made
    console.log(`  Broadcasting resolution for ${annotations.length} annotation(s) to ${sseClients.size} SSE client(s)...`);
    resolveAnnotations(annotations);
  });
}

function flushBatch() {
  if (pendingAnnotations.length === 0) return;

  const batch = [...pendingAnnotations];
  pendingAnnotations = [];
  batchTimer = null;

  // Save to JSONL for audit trail
  for (const a of batch) {
    fs.appendFileSync(
      `${PROJECT_DIR}/feedback.jsonl`,
      JSON.stringify({ ...a, timestamp: new Date().toISOString() }) + "\n"
    );
  }

  spawnCodingAgent(batch);
}

// SSE clients waiting for completion events
const sseClients = new Set();

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // SSE endpoint for browser to listen for completed annotations
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("data: connected\n\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Test endpoint: manually broadcast a resolution for given IDs
  // Usage: POST /test-resolve  body: {"ids":["123","456"]}
  if (req.method === "POST" && req.url === "/test-resolve") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { ids } = JSON.parse(body);
        console.log(`[TEST] Broadcasting resolution for IDs: ${ids}`);
        const event = JSON.stringify({ type: "resolved", ids });
        for (const client of sseClients) {
          client.write(`data: ${event}\n\n`);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, broadcast: ids, clients: sseClients.size }));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/webhook") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const { event, annotation, url } = payload;

        console.log(`[${new Date().toISOString()}] Event: ${event}`);

        if (event === "annotation.add" && annotation) {
          console.log(`  → ${annotation.comment} (${annotation.element})`);

          // Sync annotation to MCP server so we can resolve it later
          if (url) {
            try {
              // Ensure session exists
              let sessionId;
              const sessionsRes = await fetch("http://localhost:4747/sessions");
              const sessions = await sessionsRes.json();
              const existing = sessions.find((s) => s.url === url);
              if (existing) {
                sessionId = existing.id;
              } else {
                const createRes = await fetch("http://localhost:4747/sessions", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ url }),
                });
                const created = await createRes.json();
                sessionId = created.id;
              }

              // Add annotation to MCP session
              const annRes = await fetch(
                `http://localhost:4747/sessions/${sessionId}/annotations`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id: annotation.id?.toString(),
                    comment: annotation.comment,
                    element: annotation.element,
                    elementPath: annotation.elementPath,
                    url,
                  }),
                }
              );
              const annData = await annRes.json();
              console.log(`  → Synced to MCP session ${sessionId}, ann ID: ${annData.id}`);
              // Use the MCP annotation ID for resolution
              annotation._mcpId = annData.id;
            } catch (err) {
              console.error(`  MCP sync failed: ${err.message}`);
            }
          }

          pendingAnnotations.push({
            id: annotation.id,
            _mcpId: annotation._mcpId,
            element: annotation.element,
            elementPath: annotation.elementPath,
            reactComponents: annotation.reactComponents,
            comment: annotation.comment,
            cssClasses: annotation.cssClasses,
            computedStyles: annotation.computedStyles,
            selectedText: annotation.selectedText,
            url,
          });

          // Reset batch timer
          if (batchTimer) clearTimeout(batchTimer);
          batchTimer = setTimeout(flushBatch, BATCH_WINDOW_MS);
          console.log(
            `  → Queued (${pendingAnnotations.length} pending, flushing in ${BATCH_WINDOW_MS / 1000}s)`
          );
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error("Parse error:", err.message);
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Agentation webhook receiver listening on http://0.0.0.0:${PORT}/webhook`);
  console.log(`Batch window: ${BATCH_WINDOW_MS / 1000}s — annotations are collected then sent to Codex`);
  console.log(`Agent: codex --full-auto (openai-codex/gpt-5.3-codex)`);
});
