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
  const modelApiUrl = baseUrl ? `${baseUrl}/agent/models` : "";
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

  // Defensive overflow fix for form controls in overlay modals
  if (!document.getElementById("agentation-overflow-fix")) {
    const fix = document.createElement("style");
    fix.id = "agentation-overflow-fix";
    fix.textContent = `
      input, textarea, select, button { box-sizing: border-box; }
      .agentation-modal input,
      .agentation-modal textarea,
      .agentation-modal select,
      .agentation-modal button {
        max-width: 100%;
      }
    `;
    document.head.appendChild(fix);
  }

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
  let currentModel = "";

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

    const modelLabel = document.createElement("span");
    modelLabel.textContent = "Model:";
    modelLabel.style.cssText = "color:#666;font-weight:500;";

    const modelSelect = document.createElement("select");
    modelSelect.id = "agentation-model-select";
    modelSelect.style.cssText = "border:1px solid #d0d0d0;border-radius:4px;padding:3px 6px;font-size:12px;background:white;cursor:pointer;outline:none;color:#333;max-width:220px;";

    const agents = [
      { value: "codex", label: "⚡ Codex" },
      { value: "claude", label: "✴️ Claude" },
      { value: "openclaw", label: "🦞 OpenClaw" },
      { value: "opencode", label: "🧠 OpenCode" },
      { value: "cursor", label: "🖱️ Cursor" },
      { value: "kiro", label: "🪄 Kiro" },
    ];

    const CURATED_MODEL_OPTIONS = {
      codex: ["", "gpt-5.4", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2-codex"],
      claude: ["", "default", "sonnet", "opus", "haiku", "opusplan"],
      opencode: ["", "opencode/gpt-5.1-codex", "opencode/gpt-5.2", "anthropic/claude-sonnet-4-5"],
      cursor: ["", "gpt-5.2", "gpt-5.1", "claude-sonnet-4-6", "claude-opus-4-6"],
      kiro: ["", "default"],
      openclaw: [""],
    };

    let dynamicModelOptions = CURATED_MODEL_OPTIONS[currentAgent] || [""];

    function refreshModelOptions(optionsArg) {
      const options = optionsArg || dynamicModelOptions || CURATED_MODEL_OPTIONS[currentAgent] || [""];
      dynamicModelOptions = options;
      modelSelect.innerHTML = "";
      options.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m || "(default)";
        modelSelect.appendChild(opt);
      });
      if (!options.includes(currentModel)) currentModel = options[0] || "";
      modelSelect.value = currentModel;
    }

    async function loadModelsForAgent(agentName) {
      try {
        const res = await fetch(`${modelApiUrl}?agent=${encodeURIComponent(agentName)}`);
        const data = await res.json();
        if (res.ok && Array.isArray(data.models) && data.models.length) {
          refreshModelOptions(data.models);
          return;
        }
      } catch {}
      refreshModelOptions(CURATED_MODEL_OPTIONS[agentName] || [""]);
    }

    agents.forEach(({ value, label: text }) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      if (value === currentAgent) opt.selected = true;
      select.appendChild(opt);
    });

    refreshModelOptions();
    loadModelsForAgent(currentAgent);

    select.addEventListener("change", async () => {
      currentAgent = select.value;
      localStorage.setItem("agentation-selected-agent", currentAgent);
      await loadModelsForAgent(currentAgent);
      try {
        await fetch(agentApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent: currentAgent, model: currentModel }),
        });
        console.log(`[Agentation] Agent changed to: ${currentAgent}`);
      } catch (err) {
        console.warn("[Agentation] Failed to update agent on server:", err);
      }
    });

    modelSelect.addEventListener("change", async () => {
      currentModel = modelSelect.value;
      localStorage.setItem("agentation-selected-model", currentModel);
      try {
        await fetch(agentApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: currentModel }),
        });
      } catch (err) {
        console.warn("[Agentation] Failed to update model on server:", err);
      }
    });

    const commitBtn = document.createElement("button");
    commitBtn.textContent = "Save…";
    commitBtn.style.cssText = "border:1px solid #3b82f6;border-radius:4px;padding:3px 8px;font-size:12px;background:#eff6ff;cursor:pointer;color:#1d4ed8;font-weight:600;";

    const revertBtn = document.createElement("button");
    revertBtn.textContent = "Revert…";
    revertBtn.style.cssText = "border:1px solid #ef4444;border-radius:4px;padding:3px 8px;font-size:12px;background:#fff1f2;cursor:pointer;color:#b91c1c;font-weight:600;";

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
      box.className = "agentation-modal";
      box.style.cssText = "position:relative;width:440px;max-width:92vw;background:white;border-radius:12px;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,0.25);font-family:system-ui,-apple-system,sans-serif;overflow:hidden;box-sizing:border-box;";
      box.innerHTML = `
        <button id="ac-close" aria-label="Close" style="position:absolute;top:10px;right:10px;border:1px solid #e5e7eb;border-radius:999px;width:26px;height:26px;line-height:22px;background:white;cursor:pointer;font-size:16px;color:#666;">×</button>
        <div style="font-weight:700;font-size:15px;margin-bottom:10px;">Save Changes</div>
        <div style="font-size:12px;color:#666;margin-bottom:6px;">Commit message</div>
        <input id="agentation-commit-msg" type="text" placeholder="feat: update hero styles" style="display:block;width:100%;max-width:100%;box-sizing:border-box;border:1px solid #d0d0d0;border-radius:8px;padding:9px 10px;font-size:13px;margin-bottom:12px;" />
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <button id="ac-manual" style="border:1px solid #d0d0d0;border-radius:8px;padding:8px 10px;background:white;cursor:pointer;font-weight:500;">Commit</button>
          <button id="ac-manual-push" style="border:1px solid #3b82f6;border-radius:8px;padding:8px 10px;background:#eff6ff;color:#1d4ed8;font-weight:600;cursor:pointer;">Commit+Push</button>
          <button id="ac-agent" style="border:1px solid #10b981;border-radius:8px;padding:8px 10px;background:#ecfdf5;color:#047857;font-weight:600;cursor:pointer;">Agent Commit</button>
          <button id="ac-agent-push" style="border:1px solid #059669;border-radius:8px;padding:8px 10px;background:#d1fae5;color:#065f46;font-weight:700;cursor:pointer;">Agent Commit+Push</button>
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
      box.querySelector("#ac-close").addEventListener("click", close);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

      setTimeout(() => input.focus(), 0);
    }

    async function openRevertDialog() {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:2147483646;display:flex;align-items:center;justify-content:center;";
      const box = document.createElement("div");
      box.className = "agentation-modal";
      box.style.cssText = "position:relative;width:560px;max-width:94vw;background:white;border-radius:12px;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,0.25);font-family:system-ui,-apple-system,sans-serif;overflow:hidden;box-sizing:border-box;";
      box.innerHTML = `
        <button id="rv-close" aria-label="Close" style="position:absolute;top:10px;right:10px;border:1px solid #e5e7eb;border-radius:999px;width:26px;height:26px;line-height:22px;background:white;cursor:pointer;font-size:16px;color:#666;">×</button>
        <div style="font-weight:700;font-size:15px;margin-bottom:10px;">Revert Commit</div>
        <div style="font-size:12px;color:#666;margin-bottom:8px;">Select one of the 10 most recent commits to revert</div>
        <div id="rv-list" style="max-height:280px;overflow:auto;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:12px;padding:4px;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <button id="rv-revert" style="border:1px solid #ef4444;border-radius:8px;padding:8px 10px;background:#fff1f2;color:#b91c1c;font-weight:600;cursor:pointer;">Revert</button>
          <button id="rv-revert-push" style="border:1px solid #dc2626;border-radius:8px;padding:8px 10px;background:#fee2e2;color:#7f1d1d;font-weight:700;cursor:pointer;">Revert+Push</button>
        </div>
      `;
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      let selected = "";
      const close = () => overlay.remove();
      box.querySelector("#rv-close").addEventListener("click", close);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

      try {
        const res = await fetch(`${baseUrl}/git/recent?limit=10`);
        const data = await res.json();
        const list = box.querySelector("#rv-list");
        const commits = Array.isArray(data.commits) ? data.commits : [];
        if (!commits.length) {
          list.innerHTML = '<div style="padding:12px;font-size:12px;color:#6b7280;">No commits found.</div>';
        } else {
          selected = commits[0].hash;
          list.innerHTML = commits.map((c, idx) => `
            <label style="display:block;padding:8px 10px;border-bottom:1px solid #f3f4f6;cursor:pointer;background:${idx===0?'#fef2f2':'white'}" data-hash="${c.hash}">
              <input type="radio" name="revert-commit" value="${c.hash}" ${idx===0?'checked':''} style="margin-right:8px" />
              <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#991b1b">${c.shortHash}</span>
              <span style="margin-left:8px;font-size:12px">${c.subject}</span>
              <div style="margin-left:24px;font-size:11px;color:#6b7280">${c.author} • ${c.date}</div>
            </label>
          `).join('');
          list.querySelectorAll('input[name="revert-commit"]').forEach((el) => {
            el.addEventListener('change', () => {
              selected = el.value;
              list.querySelectorAll('label[data-hash]').forEach((lbl) => {
                lbl.style.background = lbl.getAttribute('data-hash') === selected ? '#fef2f2' : 'white';
              });
            });
          });
        }
      } catch (err) {
        box.querySelector("#rv-list").innerHTML = `<div style="padding:12px;font-size:12px;color:#b91c1c;">Failed to load commits: ${err.message || 'unknown error'}</div>`;
      }

      async function run(push) {
        if (!selected) {
          window.alert("Select a commit to revert.");
          return;
        }
        if (!window.confirm(`Revert commit ${selected.slice(0,8)}?`)) return;
        try {
          await postGit(`${baseUrl}/git/revert`, { commit: selected, push });
          window.alert(push ? "Reverted and pushed ✅" : "Reverted ✅");
          close();
        } catch (err) {
          window.alert(`Revert failed: ${err.message || "unknown error"}`);
        }
      }

      box.querySelector("#rv-revert").addEventListener("click", () => run(false));
      box.querySelector("#rv-revert-push").addEventListener("click", () => run(true));
    }

    commitBtn.addEventListener("click", openCommitDialog);
    revertBtn.addEventListener("click", openRevertDialog);

    selectorEl.appendChild(label);
    selectorEl.appendChild(select);
    selectorEl.appendChild(modelLabel);
    selectorEl.appendChild(modelSelect);
    selectorEl.appendChild(commitBtn);
    selectorEl.appendChild(revertBtn);
    document.body.appendChild(selectorEl);

    // Load saved preference
    const saved = localStorage.getItem("agentation-selected-agent");
    const savedModel = localStorage.getItem("agentation-selected-model") || "";
    if (saved && agents.some((a) => a.value === saved)) {
      currentAgent = saved;
      select.value = saved;
    }
    currentModel = savedModel;
    refreshModelOptions();

    // Fetch current server setting + installed map
    if (agentApiUrl) {
      fetch(agentApiUrl).then((r) => r.json()).then((data) => {
        if (data.installed && typeof data.installed === "object") {
          Array.from(select.options).forEach((opt) => {
            const ok = !!data.installed[opt.value];
            opt.disabled = !ok;
            const base = agents.find((a) => a.value === opt.value)?.label || opt.value;
            opt.text = ok ? base : `${base} (not installed)`;
          });
        }
        if (data.current && (!saved || !data.installed || data.installed[saved])) {
          currentAgent = data.current;
          select.value = data.current;
        }
        if (typeof data.model === "string" && !savedModel) {
          currentModel = data.model;
        }
        if (Array.isArray(data.models) && data.models.length) {
          refreshModelOptions(data.models);
        } else {
          loadModelsForAgent(currentAgent);
        }
      }).catch(() => {
        loadModelsForAgent(currentAgent);
      });

      // Sync current selection to server
      fetch(agentApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: currentAgent, model: currentModel }),
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
        if (data.type === "agent-changed") {
          if (data.agent) {
            currentAgent = data.agent;
            const sel = document.getElementById("agentation-agent-select");
            if (sel) sel.value = data.agent;
            loadModelsForAgent(currentAgent);
          }
          if (typeof data.model === "string") {
            currentModel = data.model;
            const msel = document.getElementById("agentation-model-select");
            if (msel) {
              refreshModelOptions();
              msel.value = data.model;
            }
          }
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
