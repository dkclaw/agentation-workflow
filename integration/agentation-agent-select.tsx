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
  const [showModal, setShowModal] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const gitUrl = useMemo(() => apiUrl.replace(/\/agent$/, "/git/commit"), [apiUrl]);
  const gitAutoUrl = useMemo(() => apiUrl.replace(/\/agent$/, "/git/auto-commit"), [apiUrl]);

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

  const postGit = async (url: string, payload: any) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || res.statusText);
    return data;
  };

  const runGitAction = async (mode: "manual" | "manual-push" | "agent" | "agent-push") => {
    setBusy(true);
    try {
      let data: any;
      if (mode === "agent") {
        data = await postGit(gitAutoUrl, { push: false });
      } else if (mode === "agent-push") {
        data = await postGit(gitAutoUrl, { push: true });
      } else {
        if (!message.trim()) {
          window.alert("Commit message required for manual commit.");
          return;
        }
        data = await postGit(gitUrl, { message: message.trim(), push: mode === "manual-push" });
      }
      if (data.skipped) {
        window.alert("No changes to commit.");
      } else {
        window.alert(data.message ? `Saved: ${data.message}` : "Saved ✅");
      }
      setShowModal(false);
      setMessage("");
    } catch (err: any) {
      window.alert(`Git action failed: ${err?.message || "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const posStyle = position === "bottom-left" ? { left: "20px" } : { right: "20px" };

  return (
    <>
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
          onClick={() => setShowModal(true)}
          style={{
            border: "1px solid #3b82f6",
            borderRadius: "4px",
            padding: "3px 8px",
            fontSize: "12px",
            background: "#eff6ff",
            cursor: "pointer",
            color: "#1d4ed8",
            fontWeight: 600,
          }}
        >
          Save…
        </button>
      </div>

      {showModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            zIndex: 2147483646,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "440px",
              maxWidth: "92vw",
              background: "white",
              borderRadius: "12px",
              padding: "16px",
              boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
            }}
          >
            <button
              onClick={() => setShowModal(false)}
              aria-label="Close"
              style={{
                position: "absolute",
                top: "10px",
                right: "10px",
                border: "1px solid #e5e7eb",
                borderRadius: "999px",
                width: "26px",
                height: "26px",
                lineHeight: "22px",
                background: "white",
                cursor: "pointer",
                fontSize: "16px",
                color: "#666",
              }}
            >
              ×
            </button>

            <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "10px" }}>Save Changes</div>
            <div style={{ fontSize: "12px", color: "#666", marginBottom: "6px" }}>Commit message</div>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="feat: update hero styles"
              style={{
                width: "100%",
                border: "1px solid #d0d0d0",
                borderRadius: "8px",
                padding: "9px 10px",
                fontSize: "13px",
                marginBottom: "12px",
              }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <button disabled={busy} onClick={() => runGitAction("manual")} style={{ border: "1px solid #d0d0d0", borderRadius: "8px", padding: "8px 10px", background: "white", fontWeight: 500 }}>Commit</button>
              <button disabled={busy} onClick={() => runGitAction("manual-push")} style={{ border: "1px solid #3b82f6", borderRadius: "8px", padding: "8px 10px", background: "#eff6ff", color: "#1d4ed8", fontWeight: 600 }}>Commit+Push</button>
              <button disabled={busy} onClick={() => runGitAction("agent")} style={{ border: "1px solid #10b981", borderRadius: "8px", padding: "8px 10px", background: "#ecfdf5", color: "#047857", fontWeight: 600 }}>Agent Commit</button>
              <button disabled={busy} onClick={() => runGitAction("agent-push")} style={{ border: "1px solid #059669", borderRadius: "8px", padding: "8px 10px", background: "#d1fae5", color: "#065f46", fontWeight: 700 }}>Agent Commit+Push</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
