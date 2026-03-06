'use client';

import { useEffect, useMemo, useState } from "react";

const AGENTS = [
  { value: "codex", label: "⚡ Codex" },
  { value: "claude", label: "✴️ Claude" },
  { value: "openclaw", label: "🦞 OpenClaw" },
  { value: "opencode", label: "🧠 OpenCode" },
  { value: "cursor", label: "🖱️ Cursor" },
  { value: "kiro", label: "🪄 Kiro" },
] as const;

const CURATED_MODEL_OPTIONS: Record<string, string[]> = {
  codex: ["", "gpt-5.4", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2-codex"],
  claude: ["", "default", "sonnet", "opus", "haiku", "opusplan"],
  opencode: [""],
  cursor: ["", "gpt-5.2", "gpt-5.1", "claude-sonnet-4-6", "claude-opus-4-6"],
  kiro: ["", "default"],
  openclaw: [""],
};

const STORAGE_KEY = "agentation-selected-agent";
const MODEL_STORAGE_KEY = "agentation-selected-model";

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
  const [model, setModel] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(MODEL_STORAGE_KEY) || "";
  });
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelSource, setModelSource] = useState("curated");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customModelText, setCustomModelText] = useState("");

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [commits, setCommits] = useState<CommitItem[]>([]);
  const [selectedCommit, setSelectedCommit] = useState("");

  const modelApiUrl = useMemo(() => apiUrl.replace(/\/agent$/, "/agent/models"), [apiUrl]);
  const gitUrl = useMemo(() => apiUrl.replace(/\/agent$/, "/git/commit"), [apiUrl]);
  const gitAutoUrl = useMemo(() => apiUrl.replace(/\/agent$/, "/git/auto-commit"), [apiUrl]);
  const gitRecentUrl = useMemo(() => apiUrl.replace(/\/agent$/, "/git/recent?limit=10"), [apiUrl]);
  const gitRevertUrl = useMemo(() => apiUrl.replace(/\/agent$/, "/git/revert"), [apiUrl]);

  const syncAgentConfig = async (next: { agent?: string; model?: string }) => {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || res.statusText);
    return data;
  };

  const fetchModelOptions = async (agentName: string) => {
    try {
      const res = await fetch(`${modelApiUrl}?agent=${encodeURIComponent(agentName)}`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || res.statusText);
      const opts = Array.isArray(data.models) && data.models.length ? data.models : (CURATED_MODEL_OPTIONS[agentName] || [""]);
      setModelOptions(opts);
      setModelSource(data.source || "curated");
      if (!opts.includes(model)) {
        const fallback = opts[0] || "";
        setModel(fallback);
        localStorage.setItem(MODEL_STORAGE_KEY, fallback);
        await syncAgentConfig({ model: fallback });
      }
    } catch {
      const fallbackOpts = CURATED_MODEL_OPTIONS[agentName] || [""];
      setModelOptions(fallbackOpts);
      setModelSource("curated-fallback");
    }
  };

  useEffect(() => {
    fetch(apiUrl)
      .then((r) => r.json())
      .then((data) => {
        if (data.current) {
          setAgent(data.current);
          localStorage.setItem(STORAGE_KEY, data.current);
        }
        if (typeof data.model === "string") {
          setModel(data.model);
          localStorage.setItem(MODEL_STORAGE_KEY, data.model);
        }
        if (data.installed && typeof data.installed === "object") {
          setInstalled(data.installed);
        }
        if (Array.isArray(data.models)) {
          setModelOptions(data.models);
        }
        if (typeof data.modelSource === "string") {
          setModelSource(data.modelSource);
        }
      })
      .catch(() => {});
  }, [apiUrl]);

  useEffect(() => {
    const es = new EventSource(sseUrl);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "agent-changed") {
          if (data.agent) {
            setAgent(data.agent);
            localStorage.setItem(STORAGE_KEY, data.agent);
          }
          if (typeof data.model === "string") {
            setModel(data.model);
            localStorage.setItem(MODEL_STORAGE_KEY, data.model);
          }
        }
      } catch {}
    };
    return () => es.close();
  }, [sseUrl]);

  useEffect(() => {
    fetchModelOptions(agent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  const handleAgentChange = async (newAgent: string) => {
    setAgent(newAgent);
    localStorage.setItem(STORAGE_KEY, newAgent);
    try {
      await syncAgentConfig({ agent: newAgent, model });
    } catch (err: any) {
      window.alert(`Failed to set agent: ${err?.message || "unknown error"}`);
    }
  };

  const handleModelChange = async (newModel: string) => {
    setModel(newModel);
    localStorage.setItem(MODEL_STORAGE_KEY, newModel);
    try {
      await syncAgentConfig({ model: newModel });
    } catch (err: any) {
      window.alert(`Failed to set model: ${err?.message || "unknown error"}`);
    }
  };

  const handleCustomModel = async () => {
    if (!customModelText.trim()) {
      setShowCustomInput(false);
      return;
    }
    await handleModelChange(customModelText.trim());
    setCustomModelText("");
    setShowCustomInput(false);
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
      if (mode === "agent") data = await postJson(gitAutoUrl, { push: false });
      else if (mode === "agent-push") data = await postJson(gitAutoUrl, { push: true });
      else {
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
          flexWrap: "wrap",
          maxWidth: "min(92vw, 860px)",
        }}
      >
        <span style={{ color: "#666", fontWeight: 500 }}>Agent:</span>
        <select
          value={agent}
          onChange={(e) => handleAgentChange(e.target.value)}
          style={{ border: "1px solid #d0d0d0", borderRadius: "4px", padding: "3px 6px", fontSize: "12px", background: "white", cursor: "pointer", outline: "none", color: "#333" }}
        >
          {AGENTS.map(({ value, label }) => {
            const ok = installed[value] ?? true;
            return (
              <option key={value} value={value} disabled={!ok}>
                {ok ? label : `${label} (not installed)`}
              </option>
            );
          })}
        </select>

        <span style={{ color: "#666", fontWeight: 500 }} title={`Model source: ${modelSource}`}>Model:</span>
        {showCustomInput ? (
          <input
            type="text"
            value={customModelText}
            onChange={(e) => setCustomModelText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleCustomModel();
              } else if (e.key === "Escape") {
                setShowCustomInput(false);
                setModel("");
              }
            }}
            style={{ border: "1px solid #3b82f6", borderRadius: "4px", padding: "3px 8px", fontSize: "12px", background: "white", outline: "none", width: "200px", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", fontFamily: "sans-serif" }}
            autoFocus
          />
        ) : (
          <select
            value={model}
            onChange={(e) => {
              if (e.target.value === "custom") {
                setShowCustomInput(true);
              } else {
                handleModelChange(e.target.value);
              }
            }}
            style={{ border: "1px solid #d0d0d0", borderRadius: "4px", padding: "3px 6px", fontSize: "12px", background: "white", cursor: "pointer", outline: "none", color: "#333", maxWidth: "220px" }}
          >
            {modelOptions.map((m) => {
              const text = m ? String(m) : "(default)";
              return (
                <option key={m || "default"} value={m || ""}>
                  {text}
                </option>
              );
            })}
            <option value="custom">Custom…</option>
          </select>
        )}
      </div>

      {showSaveModal && (
        <div onClick={(e) => e.target === e.currentTarget && setShowSaveModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 2147483646, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, -apple-system, sans-serif" }}>
          <div style={{ position: "relative", width: "440px", maxWidth: "92vw", background: "white", borderRadius: "12px", padding: "16px", boxShadow: "0 8px 30px rgba(0,0,0,0.25)", overflow: "hidden", boxSizing: "border-box" }}>
            <button onClick={() => setShowSaveModal(false)} aria-label="Close" style={{ position: "absolute", top: "10px", right: "10px", border: "1px solid #e5e7eb", borderRadius: "999px", width: "26px", height: "26px", lineHeight: "22px", background: "white", cursor: "pointer", fontSize: "16px", color: "#666" }}>×</button>
            <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "10px" }}>Save Changes</div>
            <div style={{ fontSize: "12px", color: "#666", marginBottom: "6px" }}>Commit message</div>
            <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="feat: update hero styles" style={{ display: "block", width: "100%", maxWidth: "100%", boxSizing: "border-box", border: "1px solid #d0d0d0", borderRadius: "8px", padding: "9px 10px", fontSize: "13px", marginBottom: "12px" }} />
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
          <div style={{ position: "relative", width: "560px", maxWidth: "94vw", background: "white", borderRadius: "12px", padding: "16px", boxShadow: "0 8px 30px rgba(0,0,0,0.25)", overflow: "hidden", boxSizing: "border-box" }}>
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