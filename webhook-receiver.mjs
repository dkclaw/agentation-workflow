import http from "node:http";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";

// ---- CONFIGURE THESE ----
const PORT = process.env.AGENTATION_PORT || 4848;
const PROJECT_DIR = process.env.AGENTATION_PROJECT_DIR || process.cwd();
const BATCH_WINDOW_MS = parseInt(process.env.AGENTATION_BATCH_MS || "10000");

let pendingAnnotations = [];
let batchTimer = null;

// Session context persistence (for CLI "resume" behavior)
const SESSION_STORE_PATH = `${PROJECT_DIR}/.agentation-sessions.json`;
const MAX_SESSION_ENTRIES = parseInt(process.env.AGENTATION_MAX_SESSION_ENTRIES || "20", 10);

function loadSessionStore() {
  try {
    if (!fs.existsSync(SESSION_STORE_PATH)) return {};
    return JSON.parse(fs.readFileSync(SESSION_STORE_PATH, "utf8")) || {};
  } catch {
    return {};
  }
}

function saveSessionStore(store) {
  try {
    fs.writeFileSync(SESSION_STORE_PATH, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error(`[session] failed to save store: ${err.message}`);
  }
}

function makeSessionKey(url, agent) {
  const page = url || "unknown-page";
  return `${agent}::${page}`;
}

function sanitizeCommitMessage(msg) {
  return String(msg || "")
    .replace(/[`\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function generateCommitMessageWithAgent(agentName) {
  const files = execSync("git diff --cached --name-only", { cwd: PROJECT_DIR }).toString().trim();
  const stat = execSync("git diff --cached --stat", { cwd: PROJECT_DIR }).toString().trim();
  const prompt = `Generate ONE git commit message in conventional commit style for these staged changes.\n\nFiles:\n${files || "(none)"}\n\nStat:\n${stat || "(none)"}\n\nRules:\n- Output ONLY the commit message\n- Max 72 characters\n- No markdown, no quotes`;

  try {
    if (agentName === "claude") {
      const out = execSync(`claude -p ${JSON.stringify(prompt)}`, { cwd: PROJECT_DIR, timeout: 90000 });
      return sanitizeCommitMessage(out.toString().split("\n")[0]);
    }
    if (agentName === "openclaw") {
      const out = execSync(`openclaw agent --message ${JSON.stringify(prompt)} --no-interactive`, { cwd: PROJECT_DIR, timeout: 90000 });
      return sanitizeCommitMessage(out.toString().split("\n")[0]);
    }
    // default: codex
    const out = execSync(`codex --full-auto exec ${JSON.stringify(prompt)}`, { cwd: PROJECT_DIR, timeout: 90000 });
    return sanitizeCommitMessage(out.toString().split("\n")[0]);
  } catch {
    const fallback = execSync("git diff --cached --name-only | head -1", { cwd: PROJECT_DIR }).toString().trim();
    return sanitizeCommitMessage(`chore: update ${fallback || "project files"}`);
  }
}

function formatSessionContext(entries = []) {
  if (!entries.length) return "(no prior annotation history)";
  return entries
    .slice(-8)
    .map((e, i) => {
      const ts = e.time || "unknown-time";
      const changes = (e.annotations || [])
        .map((a) => `- ${a.comment} (${a.element || "element"})`)
        .join("\n");
      return `### Prior Batch ${i + 1} (${ts})\n${changes || "- no details"}`;
    })
    .join("\n\n");
}

function appendSessionEntry(sessionKey, entry) {
  const store = loadSessionStore();
  const arr = Array.isArray(store[sessionKey]) ? store[sessionKey] : [];
  arr.push(entry);
  store[sessionKey] = arr.slice(-MAX_SESSION_ENTRIES);
  saveSessionStore(store);
}

function getSessionEntries(sessionKey) {
  const store = loadSessionStore();
  return Array.isArray(store[sessionKey]) ? store[sessionKey] : [];
}

function broadcast(eventData) {
  const msg = JSON.stringify(eventData);
  for (const client of sseClients) {
    client.write(`data: ${msg}\n\n`);
  }
}

function broadcastStatus(type, ids, detail) {
  const event = { type, ids, ...(detail && { detail }) };
  console.log(`  Broadcasting ${type} to ${sseClients.size} client(s): ${ids.join(", ")}${detail ? ` (${detail})` : ""}`);
  broadcast(event);
}

function broadcastResolved(annotations) {
  const ids = annotations.map((a) => a.id?.toString()).filter(Boolean);
  broadcastStatus("resolved", ids);
}

async function resolveAnnotations(annotations) {
  broadcastResolved(annotations);
}

// ---- AGENT BACKENDS ----
const DEFAULT_AGENT = process.env.AGENTATION_AGENT || "codex";

function getAgentCommand(agentName, prompt) {
  switch (agentName) {
    case "codex":
      return { bin: "codex", args: ["--full-auto", "exec", prompt], label: "Codex" };
    case "claude":
      return { bin: "claude", args: ["-p", prompt, "--allowedTools", "Edit,Write,Read,Bash"], label: "Claude Code" };
    case "openclaw":
      return {
        bin: "openclaw",
        args: ["agent", "--message", prompt, "--no-interactive"],
        label: "OpenClaw",
      };
    default:
      return { bin: agentName, args: [prompt], label: agentName };
  }
}

function spawnCodingAgent(annotations, agentName) {
  agentName = agentName || DEFAULT_AGENT;
  const pageUrl = annotations[0]?.url || "";
  const sessionKey = makeSessionKey(pageUrl, agentName);
  const priorSessionEntries = getSessionEntries(sessionKey);

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

  // Detect project type for smarter agent prompts
  const projectType = (() => {
    if (fs.existsSync(`${PROJECT_DIR}/next.config.js`) || fs.existsSync(`${PROJECT_DIR}/next.config.mjs`) || fs.existsSync(`${PROJECT_DIR}/next.config.ts`)) {
      return {
        description: `The project is a Next.js app in ${PROJECT_DIR}. The main page component is at app/page.tsx.`,
        instructions: "- After making changes, the Next.js dev server will hot-reload automatically",
      };
    }
    if (fs.existsSync(`${PROJECT_DIR}/vite.config.js`) || fs.existsSync(`${PROJECT_DIR}/vite.config.ts`)) {
      return {
        description: `The project is a Vite app in ${PROJECT_DIR}.`,
        instructions: "- After making changes, the Vite dev server will hot-reload automatically",
      };
    }
    const pageUrl = annotations[0]?.url;
    const urlPath = pageUrl ? new URL(pageUrl).pathname : "/";
    const htmlFile = urlPath === "/" ? "index.html" : urlPath.replace(/\/$/, "") + ".html";
    return {
      description: `The project is a static HTML site in ${PROJECT_DIR}. The page being annotated is likely at ${htmlFile}. Look at the CSS paths and element selectors to find the right elements to modify.`,
      instructions: `- Edit the HTML/CSS files directly (likely ${htmlFile} or linked stylesheets)\n- The user will refresh the browser to see changes`,
    };
  })();

  const prompt = `You are fixing UI issues based on visual feedback annotations from a human reviewer.

${projectType.description}

## Session Context (resume prior intent)

Session key: ${sessionKey}
Page URL: ${pageUrl || "unknown"}

Recent prior annotation history for this same page/session:
${formatSessionContext(priorSessionEntries)}

Interpret new annotations as follow-ups to prior changes when relevant (e.g., "add back the box you removed earlier").

## Feedback to address now:

${feedbackBlock}

## Instructions:
- Fix each annotation by editing the relevant files
- Keep changes minimal and focused on what was requested
- Preserve context from prior batches in this session
- Do NOT modify any Agentation/webhook setup code or script tags
${projectType.instructions}`;

  const annotationIds = annotations.map((a) => a.id?.toString()).filter(Boolean);
  const cmd = getAgentCommand(agentName, prompt);

  console.log(`\n[${new Date().toISOString()}] Spawning ${cmd.label} agent for ${annotations.length} annotation(s)...`);

  // Log the prompt for debugging
  fs.writeFileSync(`${PROJECT_DIR}/last-agent-prompt.md`, prompt);

  // Notify browser: agent is working
  broadcastStatus("processing", annotationIds, `${cmd.label} working on ${annotations.length} annotation(s)...`);

  const agent = spawn(cmd.bin, cmd.args, {
    cwd: PROJECT_DIR,
    stdio: "pipe",
    env: { ...process.env, PATH: process.env.PATH },
  });

  // Log agent stdout/stderr
  const tag = cmd.label.toLowerCase().replace(/\s+/g, "-");
  agent.stdout?.on("data", (d) => process.stdout.write(`[${tag}] ${d}`));
  agent.stderr?.on("data", (d) => process.stderr.write(`[${tag}:err] ${d}`));

  agent.on("error", (err) => {
    console.error(`${cmd.label} spawn error: ${err.message}`);
    broadcastStatus("error", annotationIds, `${cmd.label} failed to spawn: ${err.message}. Is '${cmd.bin}' installed and on PATH?`);
  });

  agent.on("exit", (code) => {
    console.log(`\n[${new Date().toISOString()}] ${cmd.label} agent exited with code ${code}`);

    appendSessionEntry(sessionKey, {
      time: new Date().toISOString(),
      exitCode: code,
      agent: agentName,
      annotations: annotations.map((a) => ({
        id: a.id,
        comment: a.comment,
        element: a.element,
      })),
    });

    console.log(`  Broadcasting resolution for ${annotations.length} annotation(s) to ${sseClients.size} SSE client(s)...`);
    resolveAnnotations(annotations);
  });
}

let selectedAgent = DEFAULT_AGENT;

function flushBatch() {
  if (pendingAnnotations.length === 0) return;

  const batch = [...pendingAnnotations];
  const agentForBatch = selectedAgent;
  pendingAnnotations = [];
  batchTimer = null;

  // Save to JSONL for audit trail
  for (const a of batch) {
    fs.appendFileSync(
      `${PROJECT_DIR}/feedback.jsonl`,
      JSON.stringify({ ...a, agent: agentForBatch, timestamp: new Date().toISOString() }) + "\n"
    );
  }

  spawnCodingAgent(batch, agentForBatch);
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

  // Agent selection endpoint
  // GET /agent — returns current agent and available agents
  // POST /agent — set agent: {"agent":"codex"|"claude"|"openclaw"}
  if (req.url === "/agent") {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        current: selectedAgent,
        available: ["codex", "claude", "openclaw"],
      }));
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { agent } = JSON.parse(body);
          if (agent) {
            selectedAgent = agent;
            console.log(`[CONFIG] Agent changed to: ${agent}`);
            broadcast({ type: "agent-changed", agent: selectedAgent });
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ current: selectedAgent }));
        } catch (err) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // Git helper endpoints
  // GET /git/status
  // POST /git/commit { message, push?: boolean }
  if (req.url === "/git/status" && req.method === "GET") {
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: PROJECT_DIR }).toString().trim();
      const porcelain = execSync("git status --porcelain", { cwd: PROJECT_DIR }).toString();
      const clean = porcelain.trim().length === 0;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ branch, clean, changedFiles: porcelain.split("\n").filter(Boolean).length }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `git status failed: ${err.message}` }));
    }
    return;
  }

  if ((req.url === "/git/commit" || req.url === "/git/auto-commit") && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { message, push } = JSON.parse(body || "{}");
        const isAuto = req.url === "/git/auto-commit";

        const status = execSync("git status --porcelain", { cwd: PROJECT_DIR }).toString().trim();
        if (!status) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, skipped: true, detail: "No changes to commit" }));
          return;
        }

        execSync("git add -A", { cwd: PROJECT_DIR, stdio: "pipe" });

        let commitMessage = String(message || "").trim();
        if (isAuto) {
          commitMessage = generateCommitMessageWithAgent(selectedAgent) || "chore: update project files";
        }
        if (!commitMessage) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "commit message is required" }));
          return;
        }

        execSync(`git commit -m ${JSON.stringify(commitMessage)}`, { cwd: PROJECT_DIR, stdio: "pipe" });

        let pushed = false;
        if (push) {
          execSync("git push", { cwd: PROJECT_DIR, stdio: "pipe" });
          pushed = true;
        }

        const detail = isAuto
          ? `${pushed ? "Agent committed + pushed" : "Agent committed"}: ${commitMessage}`
          : `${pushed ? "Committed + pushed" : "Committed"}: ${commitMessage}`;
        broadcast({ type: "git-result", status: "success", detail });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, pushed, message: commitMessage, auto: isAuto }));
      } catch (err) {
        broadcast({ type: "git-result", status: "error", detail: `Git action failed: ${err.message}` });
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
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
        const { event, annotation, url, agent: payloadAgent } = payload;

        // Allow webhook payload to override agent selection
        if (payloadAgent && ["codex", "claude", "openclaw"].includes(payloadAgent)) {
          selectedAgent = payloadAgent;
        }

        console.log(`[${new Date().toISOString()}] Event: ${event} (agent: ${selectedAgent})`);

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

          const annId = annotation.id?.toString();
          if (annId) {
            broadcastStatus("queued", [annId], `Queued (${pendingAnnotations.length} pending, agent starts in ${BATCH_WINDOW_MS / 1000}s)`);
          }
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
  console.log(`Batch window: ${BATCH_WINDOW_MS / 1000}s — annotations are collected then sent to selected agent`);
  console.log(`Default agent: ${DEFAULT_AGENT}`);
  console.log(`Session store: ${SESSION_STORE_PATH}`);
});
