/**
 * Agentation Vanilla Loader
 * 
 * Drop this <script> into ANY HTML page to get the full Agentation toolbar
 * + auto-resolution via SSE. No build step required.
 *
 * Usage:
 *   <script 
 *     src="https://raw.githubusercontent.com/dkclaw/agentation-workflow/master/integration/agentation-vanilla.js"
 *     data-webhook="http://YOUR_SERVER:4848/webhook"
 *     data-sse="http://YOUR_SERVER:4848/events"
 *     data-mcp="http://YOUR_SERVER:4747"
 *   ></script>
 *
 * Or simpler (just webhook, no MCP):
 *   <script src="agentation-vanilla.js" data-webhook="http://localhost:4848/webhook"></script>
 *
 * Config via data attributes on the script tag:
 *   data-webhook  — Webhook receiver URL (required)
 *   data-sse      — SSE endpoint for auto-resolution (default: derives from webhook URL)
 *   data-mcp      — MCP server URL (optional)
 *   data-auto-send — Auto-send annotations (default: true)
 */
(function () {
  "use strict";

  // --- Config from script tag ---
  const scriptTag = document.currentScript;
  const webhookUrl = scriptTag?.getAttribute("data-webhook") || "";
  const mcpUrl = scriptTag?.getAttribute("data-mcp") || "";
  const autoSend = scriptTag?.getAttribute("data-auto-send") !== "false";

  // Derive URLs from webhook URL if not explicitly set
  const baseUrl = webhookUrl.replace(/\/webhook$/, "");
  const sseUrl = scriptTag?.getAttribute("data-sse") || (baseUrl ? `${baseUrl}/events` : "");
  const agentApiUrl = baseUrl ? `${baseUrl}/agent` : "";
  const gitApiUrl = baseUrl ? `${baseUrl}/git/commit` : "";

  if (!webhookUrl) {
    console.error(
      "[Agentation] No data-webhook attribute set on script tag. Example:\n" +
        '<script src="agentation-vanilla.js" data-webhook="http://localhost:4848/webhook"></script>'
    );
    return;
  }

  // --- Constants ---
  const STORAGE_PREFIX = "feedback-annotations-";
  const REACT_CDN = "https://esm.sh/react@19?bundle";
  const REACT_DOM_CDN = "https://esm.sh/react-dom@19/client?bundle";
  const AGENTATION_CDN = "https://esm.sh/agentation?bundle&external=react,react-dom";

  // --- SSE Listener for auto-resolution ---
  let remountCounter = 0;
  let renderFn = null;

  function removeFromStorage(ids) {
    const pathname = window.location.pathname;
    const key = STORAGE_PREFIX + pathname;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const annotations = JSON.parse(raw);
      const idSet = new Set(ids.map(String));
      const filtered = annotations.filter((a) => !idSet.has(String(a.id)));
      if (filtered.length === annotations.length) return false;
      if (filtered.length === 0) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(filtered));
      }
      console.log(
        `[Agentation] Removed ${annotations.length - filtered.length} resolved annotation(s) from storage`
      );
      return true;
    } catch {
      return false;
    }
  }

  // --- Status indicator (vanilla DOM) ---
  let statusEl = null;
  const STATUS_CONFIG = {
    queued:     { bg: "#FFF8E1", border: "#FFD54F", icon: "⏳" },
    processing: { bg: "#E3F2FD", border: "#42A5F5", icon: "⚙️" },
    resolved:   { bg: "#E8F5E9", border: "#66BB6A", icon: "✅" },
    error:      { bg: "#FFEBEE", border: "#EF5350", icon: "❌" },
  };
  let statusHideTimer = null;

  function showStatus(type, message) {
    if (!statusEl) {
      statusEl = document.createElement("div");
      statusEl.id = "agentation-status";
      statusEl.style.cssText = "position:fixed;bottom:70px;right:20px;z-index:999998;padding:8px 14px;border-radius:8px;font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:#333;display:flex;align-items:center;gap:6px;max-width:320px;box-shadow:0 2px 8px rgba(0,0,0,0.15);transition:opacity 0.2s;";
      document.body.appendChild(statusEl);
    }
    const cfg = STATUS_CONFIG[type] || STATUS_CONFIG.processing;
    statusEl.style.backgroundColor = cfg.bg;
    statusEl.style.border = `1px solid ${cfg.border}`;
    statusEl.style.opacity = "1";
    statusEl.style.display = "flex";
    const spinner = type === "processing" ? ' <span style="display:inline-block;width:12px;height:12px;border:2px solid #42A5F5;border-top-color:transparent;border-radius:50%;animation:agentation-spin 0.8s linear infinite"></span>' : "";
    statusEl.innerHTML = `<span style="font-size:16px">${cfg.icon}</span><span>${message}</span>${spinner}`;

    if (!document.getElementById("agentation-status-css")) {
      const style = document.createElement("style");
      style.id = "agentation-status-css";
      style.textContent = "@keyframes agentation-spin{to{transform:rotate(360deg)}}";
      document.head.appendChild(style);
    }
  }

  function hideStatus(delayMs) {
    if (statusHideTimer) clearTimeout(statusHideTimer);
    statusHideTimer = setTimeout(() => {
      if (statusEl) { statusEl.style.opacity = "0"; setTimeout(() => { if (statusEl) statusEl.style.display = "none"; }, 200); }
    }, delayMs);
  }

  // --- Agent selector dropdown ---
  let selectorEl = null;
  let currentAgent = "codex";

  function createAgentSelector() {
    console.log("[Agentation] Creating agent selector, agentApiUrl:", agentApiUrl);
    selectorEl = document.createElement("div");
    selectorEl.id = "agentation-agent-selector";
    selectorEl.style.cssText = "position:fixed;bottom:16px;left:20px;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;font-size:13px;display:flex;align-items:center;gap:6px;background:white;padding:8px 12px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.18);border:1px solid #ccc;";

    const label = document.createElement("span");
    label.textContent = "Agent:";
    label.style.cssText = "color:#666;font-weight:500;";

    const select = document.createElement("select");
    select.id = "agentation-agent-select";
    select.style.cssText = "border:1px solid #d0d0d0;border-radius:4px;padding:3px 6px;font-size:12px;background:white;cursor:pointer;outline:none;color:#333;";

    const agents = [
      { value: "codex", label: "⚡ Codex" },
      { value: "claude", label: "✴️ Claude" },
      { value: "openclaw", label: "🦞 OpenClaw" },
    ];

    agents.forEach(({ value, label: text }) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      if (value === currentAgent) opt.selected = true;
      select.appendChild(opt);
    });

    select.addEventListener("change", async () => {
      currentAgent = select.value;
      localStorage.setItem("agentation-selected-agent", currentAgent);
      try {
        await fetch(agentApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent: currentAgent }),
        });
        console.log(`[Agentation] Agent changed to: ${currentAgent}`);
      } catch (err) {
        console.warn("[Agentation] Failed to update agent on server:", err);
      }
    });

    const commitBtn = document.createElement("button");
    commitBtn.textContent = "Save…";
    commitBtn.style.cssText = "border:1px solid #3b82f6;border-radius:4px;padding:3px 8px;font-size:12px;background:#eff6ff;cursor:pointer;color:#1d4ed8;font-weight:600;";

    async function postGit(path, payload) {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || res.statusText);
      return data;
    }

    function openCommitDialog() {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:2147483646;display:flex;align-items:center;justify-content:center;";

      const box = document.createElement("div");
      box.style.cssText = "width:420px;max-width:92vw;background:white;border-radius:10px;padding:14px;box-shadow:0 8px 30px rgba(0,0,0,0.25);font-family:system-ui,-apple-system,sans-serif;";
      box.innerHTML = `
        <div style="font-weight:700;font-size:14px;margin-bottom:8px;">Save Changes</div>
        <div style="font-size:12px;color:#666;margin-bottom:6px;">Commit message</div>
        <input id="agentation-commit-msg" type="text" placeholder="feat: update hero styles" style="width:100%;border:1px solid #d0d0d0;border-radius:6px;padding:8px;font-size:13px;margin-bottom:10px;" />
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button id="ac-manual" style="border:1px solid #d0d0d0;border-radius:6px;padding:6px 10px;background:white;cursor:pointer;">Commit</button>
          <button id="ac-manual-push" style="border:1px solid #3b82f6;border-radius:6px;padding:6px 10px;background:#eff6ff;color:#1d4ed8;font-weight:600;cursor:pointer;">Commit+Push</button>
          <button id="ac-agent" style="border:1px solid #10b981;border-radius:6px;padding:6px 10px;background:#ecfdf5;color:#047857;font-weight:600;cursor:pointer;">Agent Commit</button>
          <button id="ac-agent-push" style="border:1px solid #059669;border-radius:6px;padding:6px 10px;background:#d1fae5;color:#065f46;font-weight:700;cursor:pointer;">Agent Commit+Push</button>
          <button id="ac-cancel" style="margin-left:auto;border:1px solid #ddd;border-radius:6px;padding:6px 10px;background:#fafafa;cursor:pointer;">Cancel</button>
        </div>
      `;
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      const input = box.querySelector("#agentation-commit-msg");
      const close = () => overlay.remove();

      const run = async (mode) => {
        try {
          let data;
          if (mode === "agent") {
            data = await postGit(`${baseUrl}/git/auto-commit`, { push: false });
          } else if (mode === "agent-push") {
            data = await postGit(`${baseUrl}/git/auto-commit`, { push: true });
          } else {
            const message = (input.value || "").trim();
            if (!message) {
              window.alert("Commit message required for manual commit.");
              return;
            }
            data = await postGit(gitApiUrl, { message, push: mode === "manual-push" });
          }
          if (data.skipped) {
            window.alert("No changes to commit.");
          } else {
            window.alert(data.message ? `Saved: ${data.message}` : "Saved ✅");
          }
          close();
        } catch (err) {
          window.alert(`Git action failed: ${err.message || "unknown error"}`);
        }
      };

      box.querySelector("#ac-manual").addEventListener("click", () => run("manual"));
      box.querySelector("#ac-manual-push").addEventListener("click", () => run("manual-push"));
      box.querySelector("#ac-agent").addEventListener("click", () => run("agent"));
      box.querySelector("#ac-agent-push").addEventListener("click", () => run("agent-push"));
      box.querySelector("#ac-cancel").addEventListener("click", close);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

      setTimeout(() => input.focus(), 0);
    }

    commitBtn.addEventListener("click", openCommitDialog);

    selectorEl.appendChild(label);
    selectorEl.appendChild(select);
    selectorEl.appendChild(commitBtn);
    document.body.appendChild(selectorEl);

    // Load saved preference
    const saved = localStorage.getItem("agentation-selected-agent");
    if (saved && agents.some((a) => a.value === saved)) {
      currentAgent = saved;
      select.value = saved;
      // Sync to server
      fetch(agentApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: currentAgent }),
      }).catch(() => {});
    }

    // Fetch current server setting
    if (agentApiUrl) {
      fetch(agentApiUrl).then((r) => r.json()).then((data) => {
        if (data.current && !saved) {
          currentAgent = data.current;
          select.value = data.current;
        }
      }).catch(() => {});
    }
  }

  function connectSSE() {
    if (!sseUrl) return;
    const es = new EventSource(sseUrl);
    es.onmessage = (event) => {
      if (event.data === "connected") return;
      try {
        const data = JSON.parse(event.data);

        // Sync agent selector if server changed
        if (data.type === "agent-changed" && data.agent) {
          currentAgent = data.agent;
          const sel = document.getElementById("agentation-agent-select");
          if (sel) sel.value = data.agent;
        }

        // Show status indicator
        if (data.type === "queued") {
          showStatus("queued", data.detail || "Annotation queued...");
        } else if (data.type === "processing") {
          showStatus("processing", data.detail || "Agent working...");
        } else if (data.type === "error") {
          showStatus("error", data.detail || "Agent error");
          hideStatus(15000);
        }

        if (data.type === "git-result") {
          if (data.status === "success") {
            showStatus("resolved", data.detail || "Git action completed");
            hideStatus(5000);
          } else {
            showStatus("error", data.detail || "Git action failed");
            hideStatus(12000);
          }
        }

        // Handle resolution
        if (data.type === "resolved" && data.ids?.length) {
          console.log("[Agentation] Resolved IDs received:", data.ids);
          showStatus("resolved", `Done! ${data.ids.length} annotation(s) fixed`);
          hideStatus(5000);
          const changed = removeFromStorage(data.ids);
          if (changed && renderFn) {
            remountCounter++;
            renderFn(remountCounter);
          }
        }
      } catch {}
    };
    es.onerror = () => {
      console.warn("[Agentation] SSE connection error, will retry...");
    };
  }

  // --- Load React + Agentation dynamically ---
  async function boot() {
    try {
      // Dynamic import React and Agentation from ESM CDN
      const [ReactModule, ReactDOMModule, AgentationModule] = await Promise.all([
        import(/* webpackIgnore: true */ REACT_CDN),
        import(/* webpackIgnore: true */ REACT_DOM_CDN),
        import(/* webpackIgnore: true */ AGENTATION_CDN),
      ]);

      const React = ReactModule.default || ReactModule;
      const ReactDOM = ReactDOMModule.default || ReactDOMModule;
      const { Agentation } = AgentationModule;

      if (!Agentation) {
        console.error("[Agentation] Failed to load Agentation component from CDN");
        return;
      }

      // Create mount point
      const mountDiv = document.createElement("div");
      mountDiv.id = "agentation-vanilla-root";
      mountDiv.style.cssText = "position:fixed;z-index:999999;";
      document.body.appendChild(mountDiv);

      const root = ReactDOM.createRoot(mountDiv);

      // Render function that accepts remount key
      renderFn = (key) => {
        const props = {
          key: "agentation-" + key,
          webhookUrl: webhookUrl,
          autoSend: autoSend,
        };
        if (mcpUrl) props.mcpUrl = mcpUrl;

        root.render(React.createElement(Agentation, props));
      };

      // Initial render
      renderFn(remountCounter);

      // Start SSE listener + agent selector
      connectSSE();
      createAgentSelector();

      console.log("[Agentation] Vanilla loader initialized", {
        webhook: webhookUrl,
        sse: sseUrl,
        mcp: mcpUrl || "(none)",
        agent: currentAgent,
      });
    } catch (err) {
      console.error("[Agentation] Failed to load:", err);

      // Fallback: try loading React from alternative CDN
      console.log("[Agentation] Trying alternative CDN...");
      try {
        const [ReactModule, ReactDOMModule, AgentationModule] =
          await Promise.all([
            import("https://cdn.jsdelivr.net/npm/react@19/+esm"),
            import("https://cdn.jsdelivr.net/npm/react-dom@19/client/+esm"),
            import("https://cdn.jsdelivr.net/npm/agentation/+esm"),
          ]);

        // Same boot logic with fallback CDN
        const React = ReactModule.default || ReactModule;
        const ReactDOM = ReactDOMModule.default || ReactDOMModule;
        const { Agentation } = AgentationModule;

        const mountDiv = document.createElement("div");
        mountDiv.id = "agentation-vanilla-root";
        document.body.appendChild(mountDiv);
        const root = ReactDOM.createRoot(mountDiv);

        renderFn = (key) => {
          const props = {
            key: "agentation-" + key,
            webhookUrl,
            autoSend,
          };
          if (mcpUrl) props.mcpUrl = mcpUrl;
          root.render(React.createElement(Agentation, props));
        };
        renderFn(remountCounter);
        connectSSE();
        createAgentSelector();
      } catch (err2) {
        console.error("[Agentation] All CDNs failed:", err2);
      }
    }
  }

  // Boot when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
