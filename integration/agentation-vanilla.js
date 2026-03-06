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

  // Derive SSE URL from webhook URL if not explicitly set
  const sseUrl =
    scriptTag?.getAttribute("data-sse") ||
    (webhookUrl ? webhookUrl.replace(/\/webhook$/, "/events") : "");

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

  function connectSSE() {
    if (!sseUrl) return;
    const es = new EventSource(sseUrl);
    es.onmessage = (event) => {
      if (event.data === "connected") return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "resolved" && data.ids?.length) {
          console.log("[Agentation] Resolved IDs received:", data.ids);
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

      // Start SSE listener
      connectSSE();

      console.log("[Agentation] Vanilla loader initialized", {
        webhook: webhookUrl,
        sse: sseUrl,
        mcp: mcpUrl || "(none)",
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
