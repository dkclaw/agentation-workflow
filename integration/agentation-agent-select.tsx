"use client";

import { useEffect, useMemo, useState } from "react";

const AGENTS = [
  { value: "codex", label: "⚡ Codex" },
  { value: "claude", label: "✴️ Claude" },
  { value: "openclaw", label: "🦞 OpenClaw" },
];

const STORAGE_KEY = "agentation-selected-agent";

export function AgentSelect({
  apiUrl = "http://localhost:4848/agent",
  sseUrl = "http://localhost:4848/events",
  position = "bottom-left" as "bottom-left" | "bottom-right",
}) {
  const [agent, setAgent] = useState(() => {
    if (typeof window === "undefined") return "codex";
    return localStorage.getItem(STORAGE_KEY) || "codex";
  });
  const [busy, setBusy] = useState(false);

  const gitUrl = useMemo(() => apiUrl.replace(/\/agent$/, "/git/commit"), [apiUrl]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      fetch(apiUrl)
        .then((r) => r.json())
        .then((data) => {
          if (data.current) setAgent(data.current);
        })
        .catch(() => {});
    }
  }, [apiUrl]);

  useEffect(() => {
    const es = new EventSource(sseUrl);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "agent-changed" && data.agent) {
          setAgent(data.agent);
          localStorage.setItem(STORAGE_KEY, data.agent);
        }
      } catch {}
    };
    return () => es.close();
  }, [sseUrl]);

  const handleChange = async (newAgent: string) => {
    setAgent(newAgent);
    localStorage.setItem(STORAGE_KEY, newAgent);
    try {
      await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: newAgent }),
      });
    } catch (err) {
      console.warn("[Agentation] Failed to update agent on server:", err);
    }
  };

  const runGitAction = async (push: boolean) => {
    const message = window.prompt(push ? "Commit message (then push):" : "Commit message:");
    if (!message || !message.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(gitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim(), push }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        window.alert(`Git action failed: ${data.error || res.statusText}`);
      } else if (data.skipped) {
        window.alert("No changes to commit.");
      } else {
        window.alert(push ? "Committed and pushed ✅" : "Committed ✅");
      }
    } catch (err: any) {
      window.alert(`Git action failed: ${err?.message || "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const posStyle = position === "bottom-left" ? { left: "20px" } : { right: "20px" };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "70px",
        ...posStyle,
        zIndex: 999998,
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "12px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "white",
        padding: "6px 10px",
        borderRadius: "8px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        border: "1px solid #e0e0e0",
      }}
    >
      <span style={{ color: "#666", fontWeight: 500 }}>Agent:</span>
      <select
        value={agent}
        onChange={(e) => handleChange(e.target.value)}
        style={{
          border: "1px solid #d0d0d0",
          borderRadius: "4px",
          padding: "3px 6px",
          fontSize: "12px",
          background: "white",
          cursor: "pointer",
          outline: "none",
          color: "#333",
        }}
      >
        {AGENTS.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <button
        onClick={() => runGitAction(false)}
        disabled={busy}
        style={{
          border: "1px solid #d0d0d0",
          borderRadius: "4px",
          padding: "3px 8px",
          fontSize: "12px",
          background: busy ? "#f5f5f5" : "white",
          cursor: busy ? "not-allowed" : "pointer",
          color: "#333",
        }}
      >
        Commit
      </button>

      <button
        onClick={() => runGitAction(true)}
        disabled={busy}
        style={{
          border: "1px solid #3b82f6",
          borderRadius: "4px",
          padding: "3px 8px",
          fontSize: "12px",
          background: busy ? "#dbeafe" : "#eff6ff",
          cursor: busy ? "not-allowed" : "pointer",
          color: "#1d4ed8",
          fontWeight: 600,
        }}
      >
        Commit+Push
      </button>
    </div>
  );
}
