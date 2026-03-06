"use client";

import { useEffect, useMemo, useState } from "react";

const AGENTS = [
  { value: "codex", label: "⚡ Codex" },
  { value: "claude", label: "✴️ Claude" },
  { value: "openclaw", label: "🦞 OpenClaw" },
];

const STORAGE_KEY = "agentation-selected-agent";

type CommitItem = {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
};

export function AgentSelect({
  apiUrl = "http://localhost:4848/agent",
  sseUrl = "http://localhost:4848/events",
  position = "bottom-left" as "bottom-left" | "bottom-right",
}) {
  const [agent, setAgent] = useState(() => {
    if (typeof window === "undefined") return "codex";
    return localStorage.getItem(STORAGE_KEY) || "codex";
  });

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [commits, setCommits] = useState<CommitItem[]>([]);
  const [selectedCommit, setSelectedCommit] = useState("");

  const gitUrl = useMemo(() => apiUrl.replace(/\/agent$/, "/git/commit"), [apiUrl]);
  const gitAutoUrl = useMemo(() => apiUrl.replace(/\/agent$/, "/git/auto-commit"), [apiUrl]);
  const gitRecentUrl = useMemo(() => apiUrl.replace(/\/agent$/, "/git/recent?limit=10"), [apiUrl]);
  const gitRevertUrl = useMemo(() => apiUrl.replace(/\/agent$/, "/git/revert"), [apiUrl]);

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

  const postJson = async (url: string, payload: any) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || res.statusText);
    return data;
  };

  const runSaveAction = async (mode: "manual" | "manual-push" | "agent" | "agent-push") => {
    setBusy(true);
    try {
      let data: any;
      if (mode === "agent") {
        data = await postJson(gitAutoUrl, { push: false });
      } else if (mode === "agent-push") {
        data = await postJson(gitAutoUrl, { push: true });
      } else {
        if (!message.trim()) {
          window.alert("Commit message required for manual commit.");
          return;
        }
        data = await postJson(gitUrl, { message: message.trim(), push: mode === "manual-push" });
      }
      if (data.skipped) window.alert("No changes to commit.");
      else window.alert(data.message ? `Saved: ${data.message}` : "Saved ✅");
      setShowSaveModal(false);
      setMessage("");
    } catch (err: any) {
      window.alert(`Git action failed: ${err?.message || "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const openRevertModal = async () => {
    setShowRevertModal(true);
    setBusy(true);
    try {
      const res = await fetch(gitRecentUrl);
      const data = await res.json();
      const list: CommitItem[] = Array.isArray(data?.commits) ? data.commits : [];
      setCommits(list);
      setSelectedCommit(list[0]?.hash || "");
    } catch (err: any) {
      window.alert(`Failed to load commits: ${err?.message || "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const runRevert = async (push: boolean) => {
    if (!selectedCommit) {
      window.alert("Select a commit to revert.");
      return;
    }
    if (!window.confirm(`Revert commit ${selectedCommit.slice(0, 8)}?`)) return;
    setBusy(true);
    try {
      await postJson(gitRevertUrl, { commit: selectedCommit, push });
      window.alert(push ? "Reverted and pushed ✅" : "Reverted ✅");
      setShowRevertModal(false);
    } catch (err: any) {
      window.alert(`Revert failed: ${err?.message || "unknown error"}`);
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
          style={{ border: "1px solid #d0d0d0", borderRadius: "4px", padding: "3px 6px", fontSize: "12px", background: "white", cursor: "pointer", outline: "none", color: "#333" }}
        >
          {AGENTS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <button onClick={() => setShowSaveModal(true)} style={{ border: "1px solid #3b82f6", borderRadius: "4px", padding: "3px 8px", fontSize: "12px", background: "#eff6ff", cursor: "pointer", color: "#1d4ed8", fontWeight: 600 }}>
          Save…
        </button>

        <button onClick={openRevertModal} style={{ border: "1px solid #ef4444", borderRadius: "4px", padding: "3px 8px", fontSize: "12px", background: "#fff1f2", cursor: "pointer", color: "#b91c1c", fontWeight: 600 }}>
          Revert…
        </button>
      </div>

      {showSaveModal && (
        <div onClick={(e) => e.target === e.currentTarget && setShowSaveModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 2147483646, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, -apple-system, sans-serif" }}>
          <div style={{ position: "relative", width: "440px", maxWidth: "92vw", background: "white", borderRadius: "12px", padding: "16px", boxShadow: "0 8px 30px rgba(0,0,0,0.25)" }}>
            <button onClick={() => setShowSaveModal(false)} aria-label="Close" style={{ position: "absolute", top: "10px", right: "10px", border: "1px solid #e5e7eb", borderRadius: "999px", width: "26px", height: "26px", lineHeight: "22px", background: "white", cursor: "pointer", fontSize: "16px", color: "#666" }}>×</button>
            <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "10px" }}>Save Changes</div>
            <div style={{ fontSize: "12px", color: "#666", marginBottom: "6px" }}>Commit message</div>
            <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="feat: update hero styles" style={{ width: "100%", border: "1px solid #d0d0d0", borderRadius: "8px", padding: "9px 10px", fontSize: "13px", marginBottom: "12px" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <button disabled={busy} onClick={() => runSaveAction("manual")} style={{ border: "1px solid #d0d0d0", borderRadius: "8px", padding: "8px 10px", background: "white", fontWeight: 500 }}>Commit</button>
              <button disabled={busy} onClick={() => runSaveAction("manual-push")} style={{ border: "1px solid #3b82f6", borderRadius: "8px", padding: "8px 10px", background: "#eff6ff", color: "#1d4ed8", fontWeight: 600 }}>Commit+Push</button>
              <button disabled={busy} onClick={() => runSaveAction("agent")} style={{ border: "1px solid #10b981", borderRadius: "8px", padding: "8px 10px", background: "#ecfdf5", color: "#047857", fontWeight: 600 }}>Agent Commit</button>
              <button disabled={busy} onClick={() => runSaveAction("agent-push")} style={{ border: "1px solid #059669", borderRadius: "8px", padding: "8px 10px", background: "#d1fae5", color: "#065f46", fontWeight: 700 }}>Agent Commit+Push</button>
            </div>
          </div>
        </div>
      )}

      {showRevertModal && (
        <div onClick={(e) => e.target === e.currentTarget && setShowRevertModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 2147483646, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, -apple-system, sans-serif" }}>
          <div style={{ position: "relative", width: "560px", maxWidth: "94vw", background: "white", borderRadius: "12px", padding: "16px", boxShadow: "0 8px 30px rgba(0,0,0,0.25)" }}>
            <button onClick={() => setShowRevertModal(false)} aria-label="Close" style={{ position: "absolute", top: "10px", right: "10px", border: "1px solid #e5e7eb", borderRadius: "999px", width: "26px", height: "26px", lineHeight: "22px", background: "white", cursor: "pointer", fontSize: "16px", color: "#666" }}>×</button>
            <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "10px" }}>Revert Commit</div>
            <div style={{ fontSize: "12px", color: "#666", marginBottom: "8px" }}>Select one of the 10 most recent commits to revert</div>

            <div style={{ maxHeight: "280px", overflow: "auto", border: "1px solid #e5e7eb", borderRadius: "8px", marginBottom: "12px" }}>
              {commits.map((c) => (
                <label key={c.hash} style={{ display: "block", padding: "8px 10px", borderBottom: "1px solid #f3f4f6", cursor: "pointer", background: selectedCommit === c.hash ? "#fef2f2" : "white" }}>
                  <input type="radio" name="revert-commit" checked={selectedCommit === c.hash} onChange={() => setSelectedCommit(c.hash)} style={{ marginRight: "8px" }} />
                  <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px", color: "#991b1b" }}>{c.shortHash}</span>
                  <span style={{ marginLeft: "8px", fontSize: "12px" }}>{c.subject}</span>
                  <div style={{ marginLeft: "24px", fontSize: "11px", color: "#6b7280" }}>{c.author} • {c.date}</div>
                </label>
              ))}
              {!commits.length && <div style={{ padding: "12px", fontSize: "12px", color: "#6b7280" }}>No commits found.</div>}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <button disabled={busy || !selectedCommit} onClick={() => runRevert(false)} style={{ border: "1px solid #ef4444", borderRadius: "8px", padding: "8px 10px", background: "#fff1f2", color: "#b91c1c", fontWeight: 600 }}>Revert</button>
              <button disabled={busy || !selectedCommit} onClick={() => runRevert(true)} style={{ border: "1px solid #dc2626", borderRadius: "8px", padding: "8px 10px", background: "#fee2e2", color: "#7f1d1d", fontWeight: 700 }}>Revert+Push</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
