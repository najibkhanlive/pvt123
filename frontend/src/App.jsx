import { useState, useEffect, useRef, useCallback } from "react";

/* ═══════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════ */
const WS_URL = `ws://127.0.0.1:8000/ws/`;
const API_BASE = "";

const GROUPS = {
  A: { name: "Closure & Resolution", color: "#3B82F6", params: [1, 2, 4] },
  B: { name: "Compliance & Process", color: "#8B5CF6", params: [3, 5, 6] },
  C: { name: "Timeliness & SLA", color: "#F59E0B", params: [7, 8, 10, 11] },
  D: { name: "Categorization & Hold", color: "#10B981", params: [9, 12] },
};

/* SVG icons for each agent group */
function AgentIcon({ group, size = 20, color }) {
  const c = color || GROUPS[group]?.color || "#64748B";
  const s = { width: size, height: size, flexShrink: 0 };
  switch (group) {
    case "A": // Closure — shield with checkmark
      return <svg style={s} viewBox="0 0 24 24" fill="none"><path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" stroke={c} strokeWidth="1.5" strokeLinejoin="round"/><path d="M8.5 12.5l2.5 2.5 4.5-5" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case "B": // Compliance — clipboard with lines
      return <svg style={s} viewBox="0 0 24 24" fill="none"><rect x="5" y="4" width="14" height="17" rx="2" stroke={c} strokeWidth="1.5"/><path d="M9 2h6v3a1 1 0 01-1 1h-4a1 1 0 01-1-1V2z" stroke={c} strokeWidth="1.5"/><path d="M9 11h6M9 14.5h4" stroke={c} strokeWidth="1.5" strokeLinecap="round"/></svg>;
    case "C": // Timeliness — clock
      return <svg style={s} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" stroke={c} strokeWidth="1.5"/><path d="M12 7v5.5l3.5 2" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case "D": // Categorization — tag
      return <svg style={s} viewBox="0 0 24 24" fill="none"><path d="M4 4h7.172a2 2 0 011.414.586l8.828 8.828a2 2 0 010 2.828l-5.172 5.172a2 2 0 01-2.828 0L4.586 12.586A2 2 0 014 11.172V4z" stroke={c} strokeWidth="1.5" strokeLinejoin="round"/><circle cx="8.5" cy="8.5" r="1.5" fill={c}/></svg>;
    default:
      return <svg style={s} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke={c} strokeWidth="1.5"/></svg>;
  }
}
const PG = {1:"A",2:"A",4:"A",3:"B",5:"B",6:"B",7:"C",8:"C",10:"C",11:"C",9:"D",12:"D"};

const uid = () => Math.random().toString(36).slice(2, 10);
const ftime = (ts) => ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "";

/* ═══════════════════════════════════════════
   WEBSOCKET HOOK
   ═══════════════════════════════════════════ */
function useWS() {
  const ws = useRef(null);
  const [live, setLive] = useState(false);
  const cbs = useRef({});
  const cid = useRef(uid());

  const connect = useCallback(() => {
    const s = new WebSocket(WS_URL + cid.current);
    s.onopen = () => setLive(true);
    s.onclose = () => { setLive(false); setTimeout(connect, 2000); };
    s.onerror = () => s.close();
    s.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        cbs.current[d.type]?.(d);
        cbs.current["*"]?.(d);
      } catch {}
    };
    ws.current = s;
  }, []);

  useEffect(() => { connect(); return () => ws.current?.close(); }, [connect]);

  return {
    live,
    send: useCallback((d) => ws.current?.readyState === 1 && ws.current.send(JSON.stringify(d)), []),
    on: useCallback((t, h) => { cbs.current[t] = h; }, []),
  };
}

/* ═══════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════ */
export default function App() {
  const { live, send, on } = useWS();

  const [phase, setPhase] = useState("upload");
  const [uploadInfo, setUploadInfo] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [ticketPreviews, setTicketPreviews] = useState([]);

  const [sessionId, setSessionId] = useState(null);
  const [tickets, setTickets] = useState({});
  const [activeTicket, setActiveTicket] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [cot, setCot] = useState({});
  const [ingestions, setIngestions] = useState({});
  const [eventLog, setEventLog] = useState([]);
  const [llmLogs, setLlmLogs] = useState([]);
  const [stats, setStats] = useState({ total: 0, completed: 0 });
  const [dragOver, setDragOver] = useState(false);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState("cot"); // cot | llm | events

  const cotBoxRef = useRef(null);
  const logBoxRef = useRef(null);
  const llmBoxRef = useRef(null);

  // Upload
  const upload = async (file) => {
    setUploading(true); setUploadError(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: fd });
      if (!r.ok) { const e = await r.json(); throw new Error(e.detail); }
      const d = await r.json(); setUploadInfo(d);
      const tr = await fetch(`${API_BASE}/api/tickets`);
      const td = await tr.json();
      setTicketPreviews(td.tickets || []); setPhase("preview");
    } catch (e) { setUploadError(e.message); }
    finally { setUploading(false); }
  };

  // WS Events
  useEffect(() => {
    on("*", (evt) => {
      setEventLog((p) => [...p.slice(-400), evt]);
      if (["llm_request","llm_response_complete","llm_error","llm_parse_result","agent_retry","rate_limit_wait"].includes(evt.type)) {
        setLlmLogs((p) => [...p.slice(-200), evt]);
      }
      switch (evt.type) {
        case "session_started":
          setSessionId(evt.session_id);
          setStats({ total: evt.total_tickets, completed: 0 });
          break;
        case "ticket_started":
          setActiveTicket(evt.ticket_id);
          setSelectedTicket(evt.ticket_id);
          setTickets((p) => ({
            ...p,
            [evt.ticket_id]: {
              id: evt.ticket_id, desc: evt.short_description, priority: evt.priority,
              state: evt.state, user: evt.affected_user, country: evt.country,
              categorization: evt.categorization, status: "running",
              groups: { A: "queued", B: "queued", C: "queued", D: "queued" },
              results: {}, startTime: evt.timestamp,
            },
          }));
          break;
        case "data_ingestion":
          setIngestions((p) => {
            const key = `${evt.ticket_id}-${evt.group_id}`;
            const arr = p[key] || [];
            return { ...p, [key]: [...arr, { field: evt.field_name, value: evt.field_value }] };
          });
          break;
        case "agent_started":
          setTickets((p) => {
            const t = p[evt.ticket_id]; if (!t) return p;
            return { ...p, [evt.ticket_id]: { ...t, groups: { ...t.groups, [evt.group_id]: "ingesting" } } };
          });
          setIngestions((p) => ({ ...p, [`${evt.ticket_id}-${evt.group_id}`]: [] }));
          break;
        case "thinking": case "llm_call":
          setTickets((p) => {
            const t = p[evt.ticket_id]; if (!t) return p;
            return { ...p, [evt.ticket_id]: { ...t, groups: { ...t.groups, [evt.group_id]: "thinking" } } };
          });
          break;
        case "chain_of_thought":
          setCot((p) => {
            const key = `${evt.ticket_id}-${evt.group_id}`;
            return { ...p, [key]: (p[key] || "") + evt.chunk };
          });
          break;
        case "param_result":
          setTickets((p) => {
            const t = p[evt.ticket_id]; if (!t) return p;
            return { ...p, [evt.ticket_id]: { ...t, results: { ...t.results, [evt.result.param_id]: evt.result } } };
          });
          break;
        case "agent_complete":
          setTickets((p) => {
            const t = p[evt.ticket_id]; if (!t) return p;
            return { ...p, [evt.ticket_id]: { ...t, groups: { ...t.groups, [evt.group_id]: "complete" } } };
          });
          break;
        case "agent_error":
          setTickets((p) => {
            const t = p[evt.ticket_id]; if (!t) return p;
            return { ...p, [evt.ticket_id]: { ...t, groups: { ...t.groups, [evt.group_id]: "error" } } };
          });
          break;
        case "agent_retry":
          setTickets((p) => {
            const t = p[evt.ticket_id]; if (!t) return p;
            return { ...p, [evt.ticket_id]: { ...t, groups: { ...t.groups, [evt.group_id]: "retrying" } } };
          });
          break;
        case "ticket_complete":
          setTickets((p) => ({
            ...p, [evt.ticket_id]: { ...p[evt.ticket_id], status: "complete", summary: evt.summary },
          }));
          setStats((s) => ({ ...s, completed: s.completed + 1 }));
          setActiveTicket(null);
          break;
        case "session_complete":
          setPhase("complete");
          break;
        case "session_error":
          setUploadError(evt.error);
          break;
      }
    });
  }, [on]);

  // Auto-scroll
  const scrollToBottom = (ref) => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  };
  useEffect(() => { scrollToBottom(cotBoxRef); }, [cot]);
  useEffect(() => { scrollToBottom(logBoxRef); }, [eventLog]);
  useEffect(() => { scrollToBottom(llmBoxRef); }, [llmLogs]);

  // Actions
  const start = () => {
    setTickets({}); setCot({}); setIngestions({}); setEventLog([]); setLlmLogs([]);
    setSelectedTicket(null); setActiveTicket(null); setPhase("running");
    send({ action: "start_evaluation" });
  };
  const startSingle = (ticketId) => {
    setTickets({}); setCot({}); setIngestions({}); setEventLog([]); setLlmLogs([]);
    setSelectedTicket(null); setActiveTicket(null); setPhase("running");
    send({ action: "start_evaluation", ticket_ids: [ticketId] });
  };
  const reset = () => {
    setPhase("upload"); setUploadInfo(null); setTicketPreviews([]);
    setTickets({}); setCot({}); setIngestions({}); setEventLog([]); setLlmLogs([]); setUploadError(null);
  };

  // Export results as JSON
  const exportResults = () => {
    const data = Object.values(tickets).map(t => ({
      ticket_id: t.id,
      description: t.desc,
      priority: t.priority,
      state: t.state,
      summary: t.summary,
      results: Object.values(t.results),
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `qa-results-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  // Export CSV
  const exportCSV = () => {
    const rows = [["Ticket", "Parameter ID", "Parameter", "Verdict", "Score", "Confidence", "Reasoning"]];
    Object.values(tickets).forEach(t => {
      Object.values(t.results).forEach(r => {
        rows.push([t.id, r.param_id, r.param_name, r.verdict, r.score, r.confidence, `"${(r.reasoning || '').replace(/"/g, '""')}"`]);
      });
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `qa-results-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  // Derived
  const tList = Object.values(tickets);
  const selT = selectedTicket ? tickets[selectedTicket] : null;
  const activeGroupId = selT ? ["A","B","C","D"].find(g => ["ingesting","thinking","retrying"].includes(selT.groups[g])) : null;
  const cotKey = selectedTicket && activeGroupId ? `${selectedTicket}-${activeGroupId}` : null;

  const totalPass = tList.filter(t => t.summary).reduce((s, t) => s + (t.summary?.pass_count || 0), 0);
  const totalFail = tList.filter(t => t.summary).reduce((s, t) => s + (t.summary?.fail_count || 0), 0);
  const avgScore = tList.filter(t => t.summary).length > 0
    ? (tList.filter(t => t.summary).reduce((s, t) => s + (t.summary?.avg_score || 0), 0) / tList.filter(t => t.summary).length).toFixed(1) : "—";

  /* ═══════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════ */
  return (
    <div className="app-root">
      {/* ─── HEADER ─── */}
      <header className="header">
        <div className="header-left">
          <div className="logo-mark">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="16" height="16" rx="4" fill="#3B82F6" fillOpacity="0.15" stroke="#3B82F6" strokeWidth="1.5"/>
              <path d="M7 10L9.5 12.5L13 7.5" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="logo-text">ITSM QA Agents</span>
          <span className="version-badge">POC</span>
        </div>
        <div className="header-right">
          <div className={`conn-indicator ${live ? 'connected' : 'disconnected'}`}>
            <span className="conn-dot" />
            <span>{live ? "Connected" : "Reconnecting..."}</span>
          </div>
          {phase === "preview" && <Btn onClick={start} primary>Run All Analysis</Btn>}
          {phase === "running" && (
            <Btn onClick={() => { send({ action: "cancel_evaluation", session_id: sessionId }); setPhase("preview"); }} danger>
              Stop
            </Btn>
          )}
          {phase === "complete" && (
            <>
              <Btn onClick={() => setPhase("preview")} ghost>Back to Tickets</Btn>
              <Btn onClick={start} primary>Re-run All</Btn>
            </>
          )}
          {(phase === "running" || phase === "complete") && (
            <button className="icon-btn" onClick={() => setDrawerOpen(!drawerOpen)} title="Toggle debug panel">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          )}
        </div>
      </header>

      {/* ─── PROGRESS BAR (running/complete) ─── */}
      {(phase === "running" || phase === "complete") && (
        <div className="progress-strip">
          <div className="progress-bar" style={{ width: stats.total ? `${(stats.completed / stats.total) * 100}%` : "0%" }} />
        </div>
      )}

      {/* ═══════════════════════════════════════════
         PHASE: UPLOAD
         ═══════════════════════════════════════════ */}
      {phase === "upload" && (
        <div className="upload-screen">
          <div className="upload-hero">
            <div className="hero-glow" />
            <div className="hero-content">
              <div className="hero-icon-ring">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <path d="M16 6v12M10 12l6-6 6 6" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M6 22v2a2 2 0 002 2h16a2 2 0 002-2v-2" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h1 className="hero-title">Upload ITSM Incidents</h1>
              <p className="hero-subtitle">Drop your Excel file to begin automated quality audits powered by intelligent agents</p>

              <div
                className={`drop-zone ${dragOver ? 'active' : ''} ${uploading ? 'loading' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files[0]); }}
              >
                {uploading ? (
                  <div className="upload-loading">
                    <div className="spinner" />
                    <span>Parsing Excel file...</span>
                  </div>
                ) : (
                  <>
                    <p className="drop-label">Drag & drop .xlsx file here, or</p>
                    <label className="browse-btn">
                      Browse Files
                      <input type="file" accept=".xlsx,.xls" onChange={(e) => upload(e.target.files[0])} hidden />
                    </label>
                    <p className="drop-hint">Reads the "Incidents" sheet automatically</p>
                  </>
                )}
              </div>

              {uploadError && <div className="error-msg">⚠ {uploadError}</div>}
            </div>

            {/* Feature pills */}
            <div className="feature-row">
              {Object.entries(GROUPS).map(([id, g], i) => (
                <div key={id} className="feature-pill" style={{ '--pill-color': g.color, animationDelay: `${i * 0.1}s` }}>
                  <div className="pill-icon-wrap" style={{ '--icon-bg': g.color }}><AgentIcon group={id} size={18} color={g.color} /></div>
                  <div>
                    <div className="pill-label">Agent {id}</div>
                    <div className="pill-name">{g.name}</div>
                  </div>
                  <span className="pill-count">{g.params.length} checks</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════
         PHASE: PREVIEW
         ═══════════════════════════════════════════ */}
      {phase === "preview" && (
        <div className="preview-screen">
          <div className="preview-header">
            <div className="preview-info">
              <button className="back-link" onClick={reset}>← Upload another</button>
              <h2 className="preview-title">{uploadInfo?.filename}</h2>
              <div className="preview-meta">
                <span className="meta-chip">{uploadInfo?.count} tickets</span>
                <span className="meta-chip">{uploadInfo?.with_work_notes} with work notes</span>
              </div>
            </div>
            <Btn onClick={start} primary large>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 2l9 5-9 5V2z" fill="currentColor"/></svg>
              Analyze All Tickets
            </Btn>
          </div>

          <div className="preview-grid">
            {ticketPreviews.map((t, i) => (
              <div key={t.Number} className="preview-card" style={{ animationDelay: `${i * 0.04}s` }} onClick={() => startSingle(t.Number)}>
                <div className="pcard-top">
                  <span className="pcard-id">{t.Number}</span>
                  <span className={`pcard-state ${t.State === "Resolved" ? "resolved" : "open"}`}>{t.State}</span>
                </div>
                <p className="pcard-desc">{t["Short description"]}</p>
                <div className="pcard-bottom">
                  <span className="pcard-meta">{t.Priority}</span>
                  <span className="pcard-meta">{t.Country}</span>
                  <span className="pcard-action">Analyze →</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════
         PHASE: RUNNING / COMPLETE
         ═══════════════════════════════════════════ */}
      {(phase === "running" || phase === "complete") && (
        <div className="main-layout">
          {/* ── LEFT: Ticket sidebar ── */}
          <aside className="ticket-sidebar">
            <div className="sidebar-header">
              <span className="sidebar-label">Tickets</span>
              <span className="sidebar-count">{stats.completed}/{stats.total}</span>
            </div>
            {tList.length === 0 && <div className="sidebar-empty">Waiting for agents to start...</div>}
            {tList.map((t) => (
              <div
                key={t.id}
                className={`ticket-row ${selectedTicket === t.id ? 'selected' : ''} ${t.status}`}
                onClick={() => setSelectedTicket(t.id)}
              >
                <div className="trow-top">
                  <span className="trow-id">{t.id}</span>
                  {t.status === "running" && activeTicket === t.id ? (
                    <span className="trow-status active"><span className="live-dot" />Running</span>
                  ) : t.status === "complete" ? (
                    <span className="trow-status done">✓</span>
                  ) : (
                    <span className="trow-status queued">Queued</span>
                  )}
                </div>
                <p className="trow-desc">{t.desc?.substring(0, 60)}</p>
                {/* Mini pipeline indicator */}
                <div className="trow-pipeline">
                  {["A","B","C","D"].map((g) => (
                    <div key={g} className={`trow-dot ${t.groups[g]}`} style={{ '--gc': GROUPS[g].color }} />
                  ))}
                  {t.summary && <span className="trow-score">{t.summary.avg_score}</span>}
                </div>
              </div>
            ))}
          </aside>

          {/* ── CENTER: Main content ── */}
          <main className="center-content">
            {selT ? (
              <div className="ticket-view">
                {/* Ticket Banner */}
                <div className="ticket-banner">
                  <div className="banner-left">
                    <div className="banner-title-row">
                      <h2 className="banner-id">{selT.id}</h2>
                      <span className={`banner-badge ${selT.status}`}>
                        {selT.status === "complete" ? "✓ Complete" : "Analyzing..."}
                      </span>
                    </div>
                    <p className="banner-desc">{selT.desc}</p>
                    <div className="banner-tags">
                      <span className="btag">{selT.priority}</span>
                      <span className="btag">{selT.state}</span>
                      <span className="btag">{selT.country}</span>
                      {selT.categorization && <span className="btag">{selT.categorization}</span>}
                    </div>
                  </div>
                  {selT.summary && (
                    <div className="banner-score-ring">
                      <svg width="72" height="72" viewBox="0 0 72 72">
                        <circle cx="36" cy="36" r="30" fill="none" stroke="#1E293B" strokeWidth="4"/>
                        <circle cx="36" cy="36" r="30" fill="none" stroke={selT.summary.avg_score >= 7 ? '#10B981' : selT.summary.avg_score >= 5 ? '#F59E0B' : '#EF4444'} strokeWidth="4"
                          strokeDasharray={`${(selT.summary.avg_score / 10) * 188.5} 188.5`}
                          strokeLinecap="round" transform="rotate(-90 36 36)" style={{ transition: 'stroke-dasharray 0.8s ease' }}/>
                      </svg>
                      <div className="score-value">{selT.summary.avg_score}</div>
                      <div className="score-label">Score</div>
                    </div>
                  )}
                </div>

                {/* Agent Pipeline — Vertical Timeline */}
                <div className="section-label">Agent Pipeline</div>
                <div className="pipeline-vertical">
                  {Object.entries(GROUPS).map(([gid, g], idx) => {
                    const st = selT.groups[gid];
                    const isActive = ["ingesting","thinking","retrying"].includes(st);
                    const isDone = st === "complete";
                    const isErr = st === "error";
                    const gResults = Object.values(selT.results).filter((r) => PG[r.param_id] === gid);
                    const ingData = ingestions[`${selT.id}-${gid}`] || [];

                    return (
                      <div key={gid} className={`pipeline-step ${st}`}>
                        {/* Timeline connector */}
                        <div className="step-timeline">
                          <div className="step-node" style={{ '--node-color': isActive || isDone ? g.color : '#334155' }}>
                            {isDone ? (
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            ) : isErr ? (
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 4l6 6M10 4l-6 6" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
                            ) : isActive ? (
                              <div className="node-pulse" style={{ background: g.color }} />
                            ) : (
                              <span className="node-num">{idx + 1}</span>
                            )}
                          </div>
                          {idx < 3 && <div className="step-line" style={{ '--line-color': isDone ? g.color + '40' : '#1E293B' }} />}
                        </div>

                        {/* Step Content */}
                        <div className={`step-card ${isActive ? 'active' : ''}`} style={{ '--card-accent': g.color }}>
                          <div className="step-header">
                            <div className="step-icon-wrap" style={{ '--icon-bg': g.color }}><AgentIcon group={gid} size={18} color={g.color} /></div>
                            <div className="step-info">
                              <div className="step-name">Agent {gid}: {g.name}</div>
                              <div className="step-params">{g.params.length} parameters</div>
                            </div>
                            <StatusPill status={st} color={g.color} />
                          </div>

                          {/* Data Ingestion */}
                          {st === "ingesting" && ingData.length > 0 && (
                            <div className="ingest-section">
                              {ingData.map((d, i) => (
                                <div key={i} className="ingest-row" style={{ animationDelay: `${i * 0.12}s` }}>
                                  <span className="ingest-key">{d.field}</span>
                                  <span className="ingest-val">{d.value}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Thinking */}
                          {st === "thinking" && (
                            <div className="thinking-section">
                              <div className="think-animation">
                                <span className="think-bar" style={{ animationDelay: '0s' }} />
                                <span className="think-bar" style={{ animationDelay: '0.15s' }} />
                                <span className="think-bar" style={{ animationDelay: '0.3s' }} />
                                <span className="think-bar" style={{ animationDelay: '0.45s' }} />
                              </div>
                              <span className="think-label">Running agent analysis...</span>
                            </div>
                          )}

                          {/* Retry */}
                          {st === "retrying" && (
                            <div className="thinking-section retry">
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="retry-icon">
                                <path d="M1 7a6 6 0 1011.5-2.5M12.5 1v3.5H9" stroke="#F59E0B" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                              <span className="think-label" style={{ color: '#F59E0B' }}>Rate limited — retrying...</span>
                            </div>
                          )}

                          {/* Results */}
                          {gResults.length > 0 && (
                            <div className="step-results">
                              {gResults.map((r, ri) => (
                                <div key={r.param_id} className="sresult-row" style={{ animationDelay: `${ri * 0.15}s` }}>
                                  <span className={`sresult-verdict ${r.verdict.toLowerCase()}`}>
                                    {r.verdict === "PASS" ? "✓" : r.verdict === "FAIL" ? "✗" : "—"}
                                  </span>
                                  <span className="sresult-name">P{r.param_id}: {r.param_name}</span>
                                  <span className="sresult-score">{r.score}/10</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Detailed Results Table */}
                {Object.keys(selT.results).length > 0 && (
                  <>
                    <div className="section-label" style={{ marginTop: 24 }}>Detailed Results</div>
                    <div className="results-table">
                      <div className="rtable-header">
                        <span className="rth" style={{ width: 60 }}>Param</span>
                        <span className="rth" style={{ flex: 2 }}>Parameter Name</span>
                        <span className="rth" style={{ width: 70 }}>Verdict</span>
                        <span className="rth" style={{ width: 50 }}>Score</span>
                        <span className="rth" style={{ flex: 3 }}>Reasoning</span>
                      </div>
                      {Object.values(selT.results).sort((a, b) => a.param_id - b.param_id).map((r) => (
                        <ResultRow key={r.param_id} r={r} />
                      ))}
                    </div>
                  </>
                )}

                {/* Summary cards (when complete) */}
                {selT.summary && (
                  <>
                    <div className="section-label" style={{ marginTop: 24 }}>Summary</div>
                    <div className="summary-grid">
                      <div className="summary-card">
                        <div className="sc-value pass">{selT.summary.pass_count}</div>
                        <div className="sc-label">Passed</div>
                      </div>
                      <div className="summary-card">
                        <div className="sc-value fail">{selT.summary.fail_count}</div>
                        <div className="sc-label">Failed</div>
                      </div>
                      <div className="summary-card">
                        <div className="sc-value">{selT.summary.total_params}</div>
                        <div className="sc-label">Total Checks</div>
                      </div>
                      <div className="summary-card">
                        <div className="sc-value score">{selT.summary.avg_score}</div>
                        <div className="sc-label">Avg Score</div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="empty-center">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ opacity: 0.3 }}>
                  <rect x="4" y="4" width="32" height="32" rx="8" stroke="#64748B" strokeWidth="2"/>
                  <path d="M14 20h12M20 14v12" stroke="#64748B" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <p>{tList.length > 0 ? "Select a ticket to inspect" : "Starting evaluation..."}</p>
              </div>
            )}

            {/* Global summary bar on complete */}
            {phase === "complete" && tList.length > 0 && (
              <div className="global-summary">
                <div className="gs-stats">
                  <div className="gs-item"><span className="gs-num" style={{ color: '#10B981' }}>{totalPass}</span><span className="gs-lbl">Passed</span></div>
                  <div className="gs-item"><span className="gs-num" style={{ color: '#EF4444' }}>{totalFail}</span><span className="gs-lbl">Failed</span></div>
                  <div className="gs-item"><span className="gs-num" style={{ color: '#F59E0B' }}>{avgScore}</span><span className="gs-lbl">Avg Score</span></div>
                  <div className="gs-item"><span className="gs-num">{stats.completed}</span><span className="gs-lbl">Tickets</span></div>
                </div>
                <div className="gs-actions">
                  <Btn onClick={exportCSV} ghost small>Export CSV</Btn>
                  <Btn onClick={exportResults} ghost small>Export JSON</Btn>
                </div>
              </div>
            )}
          </main>

          {/* ── RIGHT: Debug Drawer ── */}
          <div className={`debug-drawer ${drawerOpen ? 'open' : ''}`}>
            <div className="drawer-tabs">
              {[
                { id: 'cot', label: 'Chain of Thought' },
                { id: 'llm', label: `Agent Logs (${llmLogs.length})` },
                { id: 'events', label: `Events (${eventLog.length})` },
              ].map((tab) => (
                <button key={tab.id} className={`drawer-tab ${drawerTab === tab.id ? 'active' : ''}`} onClick={() => setDrawerTab(tab.id)}>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* CoT Tab */}
            {drawerTab === "cot" && (
              <div className="drawer-body" ref={cotBoxRef}>
                {activeGroupId && <div className="drawer-context" style={{ color: GROUPS[activeGroupId]?.color }}>Agent {activeGroupId}: {GROUPS[activeGroupId]?.name}</div>}
                {cotKey && cot[cotKey] ? (
                  <pre className="cot-text">{cot[cotKey]}</pre>
                ) : (
                  <div className="drawer-empty">Agent reasoning will stream here in real-time</div>
                )}
              </div>
            )}

            {/* LLM Logs Tab */}
            {drawerTab === "llm" && (
              <div className="drawer-body" ref={llmBoxRef}>
                {llmLogs.length === 0 && <div className="drawer-empty">LLM agent call logs will appear here</div>}
                {llmLogs.map((log, i) => <LLMLogEntry key={i} log={log} />)}
              </div>
            )}

            {/* Events Tab */}
            {drawerTab === "events" && (
              <div className="drawer-body" ref={logBoxRef}>
                {eventLog.slice(-80).map((evt, i) => (
                  <div key={i} className="event-row">
                    <span className="evt-time">{ftime(evt.timestamp)}</span>
                    <span className="evt-type" style={{ color: EVT_C[evt.type] || '#475569' }}>{evt.type?.replace(/_/g, " ")}</span>
                    <span className="evt-detail">{evt.ticket_id || ""}{evt.group_id ? ` · G${evt.group_id}` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   COMPONENTS
   ═══════════════════════════════════════════ */
function Btn({ children, onClick, primary, danger, ghost, small, large, disabled }) {
  const cls = ['btn', primary && 'primary', danger && 'danger', ghost && 'ghost', small && 'small', large && 'large'].filter(Boolean).join(' ');
  return <button className={cls} onClick={onClick} disabled={disabled}>{children}</button>;
}

function StatusPill({ status, color }) {
  const cfg = {
    queued: { label: "Queued", cls: "queued" },
    ingesting: { label: "Reading data", cls: "active" },
    thinking: { label: "Thinking", cls: "active" },
    retrying: { label: "Retrying", cls: "retry" },
    complete: { label: "Complete", cls: "done" },
    error: { label: "Error", cls: "error" },
  };
  const s = cfg[status] || cfg.queued;
  return (
    <span className={`status-pill ${s.cls}`} style={{ '--pill-accent': color }}>
      {["ingesting","thinking","retrying"].includes(status) && <span className="pill-pulse" />}
      {s.label}
    </span>
  );
}

function ResultRow({ r }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rrow ${open ? 'expanded' : ''}`} onClick={() => setOpen(!open)}>
      <div className="rrow-main">
        <span className="rrow-pid">P{r.param_id}</span>
        <span className="rrow-name">{r.param_name}</span>
        <span className={`rrow-verdict ${r.verdict.toLowerCase()}`}>{r.verdict}</span>
        <span className="rrow-score">{r.score}<span className="score-max">/10</span></span>
        <span className="rrow-reasoning">{open ? r.reasoning : (r.reasoning?.substring(0, 80) + (r.reasoning?.length > 80 ? "..." : ""))}</span>
      </div>
      {open && r.evidence?.length > 0 && (
        <div className="rrow-evidence">
          <div className="evidence-label">Evidence</div>
          {r.evidence.map((e, i) => (
            <div key={i} className="evidence-item">"{e}"</div>
          ))}
        </div>
      )}
    </div>
  );
}

const EVT_C = {
  session_started: "#3B82F6", ticket_started: "#8B5CF6", agent_started: "#10B981", data_ingestion: "#06B6D4",
  thinking: "#F59E0B", llm_call: "#F97316", llm_request: "#F97316", llm_response_complete: "#10B981",
  llm_error: "#EF4444", llm_parse_result: "#06B6D4", chain_of_thought: "#334155", param_result: "#10B981",
  agent_complete: "#3B82F6", agent_error: "#EF4444", agent_retry: "#F59E0B", ticket_complete: "#8B5CF6",
  session_complete: "#10B981", rate_limit_wait: "#F97316",
};

function LLMLogEntry({ log }) {
  const [expanded, setExpanded] = useState(false);
  const t = log.type;
  const labels = {
    llm_request: { label: "→ REQUEST", cls: "req" },
    llm_response_complete: { label: "← RESPONSE", cls: "res" },
    llm_error: { label: "✗ ERROR", cls: "err" },
    llm_parse_result: { label: "PARSE", cls: log.success ? "res" : "err" },
    agent_retry: { label: "RETRY", cls: "warn" },
    rate_limit_wait: { label: "RATE LIMIT", cls: "warn" },
  };
  const l = labels[t] || { label: t, cls: "" };

  return (
    <div className={`llm-entry ${expanded ? 'expanded' : ''}`} onClick={() => setExpanded(!expanded)}>
      <div className="llm-row">
        <span className="llm-time">{ftime(log.timestamp)}</span>
        <span className={`llm-badge ${l.cls}`}>{l.label}</span>
        <span className="llm-target">{log.ticket_id} G{log.group_id}</span>
        {t === "llm_request" && <span className="llm-meta">~{log.prompt_tokens_approx} tok → {log.model}</span>}
        {t === "llm_response_complete" && <span className="llm-meta ok">{log.response_length} chars</span>}
        {t === "llm_error" && <span className="llm-meta err">{log.error?.substring(0, 50)}</span>}
        {t === "llm_parse_result" && <span className="llm-meta">{log.success ? `✓ ${log.params_parsed} params` : "✗ Failed"}</span>}
        {t === "agent_retry" && <span className="llm-meta warn">#{log.attempt}/{log.max_retries} · {log.wait_seconds}s</span>}
        {t === "rate_limit_wait" && <span className="llm-meta warn">{log.requests_in_window}/{log.max_requests} RPM · {log.wait_seconds}s</span>}
        <span className="llm-expand">{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded && (
        <div className="llm-detail">
          {t === "llm_request" && (
            <>
              <div className="llm-section-label">System Prompt</div>
              <pre className="llm-pre">{log.prompt_system}</pre>
              <div className="llm-section-label">User Prompt</div>
              <pre className="llm-pre">{log.prompt_user}</pre>
            </>
          )}
          {t === "llm_response_complete" && (
            <>
              <div className="llm-section-label">Raw Response ({log.response_length} chars)</div>
              <pre className="llm-pre">{log.raw_response}</pre>
            </>
          )}
          {t === "llm_error" && <pre className="llm-pre err">{log.error}</pre>}
          {t === "llm_parse_result" && log.verdicts && (
            <div className="llm-verdicts">
              {Object.entries(log.verdicts).map(([pid, v]) => (
                <span key={pid} className={`llm-v ${v.toLowerCase()}`}>P{pid}: {v}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   INJECT STYLES
   ═══════════════════════════════════════════ */
const styleEl = document.createElement("style");
styleEl.textContent = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

:root {
  --bg-0: #0A0F1A;
  --bg-1: #0F1629;
  --bg-2: #151D33;
  --bg-3: #1B2340;
  --border: #1E2A45;
  --border-2: #283556;
  --text-1: #F1F5F9;
  --text-2: #CBD5E1;
  --text-3: #8494B2;
  --text-4: #5A6A8A;
  --blue: #3B82F6;
  --purple: #8B5CF6;
  --green: #10B981;
  --amber: #F59E0B;
  --red: #EF4444;
  --orange: #F97316;
  --cyan: #06B6D4;
  --radius: 8px;
  --radius-lg: 12px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--border-2); }

/* ─── ROOT ─── */
.app-root {
  min-height: 100vh;
  background: var(--bg-0);
  color: var(--text-2);
  font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  display: flex;
  flex-direction: column;
  font-size: 13px;
}

/* ─── HEADER ─── */
.header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-0);
  position: sticky; top: 0; z-index: 100;
  backdrop-filter: blur(12px);
}
.header-left { display: flex; align-items: center; gap: 10px; }
.header-right { display: flex; align-items: center; gap: 8px; }
.logo-mark { display: flex; }
.logo-text { font-size: 14px; font-weight: 700; color: var(--text-1); letter-spacing: -0.02em; }
.version-badge {
  font-size: 9px; font-weight: 600; color: var(--text-4);
  border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.conn-indicator {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--text-4);
}
.conn-dot {
  width: 6px; height: 6px; border-radius: 50%;
  transition: background 0.3s;
}
.connected .conn-dot { background: var(--green); box-shadow: 0 0 6px var(--green); }
.disconnected .conn-dot { background: var(--red); }
.icon-btn {
  background: none; border: 1px solid var(--border); border-radius: 6px;
  padding: 6px; cursor: pointer; color: var(--text-3); display: flex;
  transition: all 0.15s;
}
.icon-btn:hover { border-color: var(--border-2); color: var(--text-2); background: var(--bg-2); }

/* ─── BUTTONS ─── */
.btn {
  font-family: inherit; font-size: 12px; font-weight: 600;
  padding: 7px 16px; border-radius: 6px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid transparent; transition: all 0.15s;
  white-space: nowrap;
}
.btn.primary { background: var(--blue); color: #fff; border-color: var(--blue); }
.btn.primary:hover { background: #2563EB; }
.btn.danger { background: var(--red); color: #fff; border-color: var(--red); }
.btn.ghost { background: transparent; color: var(--text-3); border-color: var(--border); }
.btn.ghost:hover { border-color: var(--border-2); color: var(--text-2); background: var(--bg-2); }
.btn.small { font-size: 11px; padding: 5px 12px; }
.btn.large { font-size: 13px; padding: 10px 24px; }

/* ─── PROGRESS ─── */
.progress-strip { height: 2px; background: var(--border); position: relative; }
.progress-bar {
  height: 100%; background: linear-gradient(90deg, var(--blue), var(--green));
  transition: width 0.6s ease; border-radius: 0 1px 1px 0;
}

/* ═══════════════════════════════════════════
   UPLOAD SCREEN
   ═══════════════════════════════════════════ */
.upload-screen {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 40px 20px;
}
.upload-hero {
  max-width: 720px; width: 100%; text-align: center; position: relative;
}
.hero-glow {
  position: absolute; top: -120px; left: 50%; transform: translateX(-50%);
  width: 600px; height: 300px;
  background: radial-gradient(ellipse, rgba(59,130,246,0.06) 0%, transparent 65%);
  pointer-events: none;
}
.upload-hero::before {
  content: ''; position: absolute; inset: -60px -40px; z-index: 0;
  background-image: 
    linear-gradient(rgba(30,42,69,0.3) 1px, transparent 1px),
    linear-gradient(90deg, rgba(30,42,69,0.3) 1px, transparent 1px);
  background-size: 40px 40px;
  mask-image: radial-gradient(ellipse 60% 50% at 50% 40%, black 20%, transparent 70%);
  -webkit-mask-image: radial-gradient(ellipse 60% 50% at 50% 40%, black 20%, transparent 70%);
}
.hero-content { position: relative; }
.hero-icon-ring {
  width: 64px; height: 64px; border-radius: 16px;
  background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.2);
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 20px;
}
.hero-title { font-size: 24px; font-weight: 700; color: var(--text-1); letter-spacing: -0.03em; margin-bottom: 8px; }
.hero-subtitle { font-size: 14px; color: var(--text-3); max-width: 440px; margin: 0 auto 28px; line-height: 1.5; }

.drop-zone {
  border: 1.5px dashed var(--border-2); border-radius: var(--radius-lg);
  padding: 36px 24px; transition: all 0.2s;
  background: var(--bg-1);
}
.drop-zone.active { border-color: var(--blue); background: rgba(59,130,246,0.04); }
.drop-zone.loading { border-color: var(--border); }
.drop-label { font-size: 13px; color: var(--text-3); margin-bottom: 12px; }
.browse-btn {
  display: inline-flex; padding: 8px 20px; border-radius: 6px;
  background: var(--blue); color: #fff; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: background 0.15s; font-family: inherit;
}
.browse-btn:hover { background: #2563EB; }
.drop-hint { font-size: 11px; color: var(--text-4); margin-top: 12px; }
.upload-loading { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 12px 0; }
.upload-loading span { font-size: 13px; color: var(--text-3); }
.spinner {
  width: 24px; height: 24px;
  border: 2px solid var(--border); border-top-color: var(--blue);
  border-radius: 50%; animation: spin 0.7s linear infinite;
}
.error-msg {
  margin-top: 16px; font-size: 12px; color: var(--red);
  padding: 8px 16px; background: rgba(239,68,68,0.06); border-radius: 6px;
}

/* Feature pills */
.feature-row {
  display: flex; gap: 8px; margin-top: 36px; flex-wrap: wrap; justify-content: center;
}
.feature-pill {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-radius: var(--radius);
  border: 1px solid var(--border); background: var(--bg-1);
  text-align: left; animation: fadeUp 0.5s ease both;
  transition: border-color 0.2s;
}
.feature-pill:hover { border-color: var(--pill-color); }
.pill-icon-wrap {
  width: 36px; height: 36px; border-radius: 8px;
  background: color-mix(in srgb, var(--icon-bg) 10%, transparent);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.pill-label { font-size: 10px; color: var(--text-4); font-weight: 500; }
.pill-name { font-size: 12px; color: var(--text-2); font-weight: 600; }
.pill-count { font-size: 10px; color: var(--text-4); font-weight: 500; margin-left: 4px; }

/* ═══════════════════════════════════════════
   PREVIEW SCREEN
   ═══════════════════════════════════════════ */
.preview-screen { flex: 1; padding: 24px; overflow-y: auto; }
.preview-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 20px;
}
.preview-info { display: flex; flex-direction: column; gap: 6px; }
.back-link {
  font-size: 12px; color: var(--text-4); background: none; border: none;
  cursor: pointer; font-family: inherit; padding: 0; text-align: left;
  transition: color 0.15s;
}
.back-link:hover { color: var(--blue); }
.preview-title { font-size: 18px; font-weight: 700; color: var(--text-1); letter-spacing: -0.02em; }
.preview-meta { display: flex; gap: 8px; flex-wrap: wrap; }
.meta-chip {
  font-size: 11px; color: var(--text-3); background: var(--bg-2);
  padding: 3px 10px; border-radius: 20px; font-weight: 500;
}

.preview-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px;
}
.preview-card {
  padding: 16px; background: var(--bg-1); border: 1px solid var(--border);
  border-radius: var(--radius); cursor: pointer; transition: all 0.2s;
  animation: fadeUp 0.4s ease both;
}
.preview-card:hover { border-color: var(--blue); background: var(--bg-2); transform: translateY(-1px); }
.pcard-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.pcard-id { font-size: 13px; font-weight: 700; color: var(--text-1); font-family: 'JetBrains Mono', monospace; }
.pcard-state { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; }
.pcard-state.resolved { background: rgba(16,185,129,0.1); color: var(--green); }
.pcard-state.open { background: rgba(245,158,11,0.1); color: var(--amber); }
.pcard-desc { font-size: 12px; color: var(--text-3); line-height: 1.5; margin-bottom: 10px; }
.pcard-bottom { display: flex; align-items: center; gap: 8px; }
.pcard-meta { font-size: 10px; color: var(--text-4); }
.pcard-action { font-size: 11px; color: var(--blue); font-weight: 600; margin-left: auto; }

/* ═══════════════════════════════════════════
   MAIN LAYOUT (running/complete)
   ═══════════════════════════════════════════ */
.main-layout {
  flex: 1; display: grid;
  grid-template-columns: 220px 1fr 0px;
  overflow: hidden;
  transition: grid-template-columns 0.3s ease;
}
.main-layout:has(.debug-drawer.open) {
  grid-template-columns: 220px 1fr 380px;
}

/* ─── SIDEBAR ─── */
.ticket-sidebar {
  border-right: 1px solid var(--border); overflow-y: auto;
  background: var(--bg-0);
}
.sidebar-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 14px 10px;
  font-size: 11px; font-weight: 600; color: var(--text-4);
  text-transform: uppercase; letter-spacing: 0.06em;
}
.sidebar-count { font-family: 'JetBrains Mono', monospace; color: var(--text-3); }
.sidebar-empty { padding: 24px 14px; text-align: center; font-size: 12px; color: var(--text-4); }

.ticket-row {
  padding: 10px 14px; cursor: pointer; transition: all 0.15s;
  border-left: 2px solid transparent;
}
.ticket-row:hover { background: var(--bg-1); }
.ticket-row.selected { background: var(--bg-1); border-left-color: var(--blue); }
.ticket-row.complete.selected { border-left-color: var(--green); }
.trow-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.trow-id { font-size: 12px; font-weight: 600; color: var(--text-2); font-family: 'JetBrains Mono', monospace; }
.trow-status { font-size: 10px; font-weight: 500; }
.trow-status.active { color: var(--blue); display: flex; align-items: center; gap: 4px; }
.trow-status.done { color: var(--green); }
.trow-status.queued { color: var(--text-4); }
.live-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--blue); animation: pulse 1.5s ease-in-out infinite; }
.trow-desc { font-size: 11px; color: var(--text-4); line-height: 1.4; margin-bottom: 6px; }
.trow-pipeline { display: flex; align-items: center; gap: 3px; }
.trow-dot {
  width: 8px; height: 8px; border-radius: 2px;
  background: var(--border); transition: background 0.3s;
}
.trow-dot.complete { background: var(--gc); }
.trow-dot.ingesting, .trow-dot.thinking, .trow-dot.retrying { background: var(--gc); opacity: 0.5; animation: pulse 1.5s ease-in-out infinite; }
.trow-dot.error { background: var(--red); }
.trow-score { margin-left: auto; font-size: 11px; font-weight: 700; color: var(--amber); font-family: 'JetBrains Mono', monospace; }

/* ─── CENTER CONTENT ─── */
.center-content {
  overflow-y: auto; padding: 20px 24px;
  display: flex; flex-direction: column;
}
.empty-center {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; color: var(--text-4); font-size: 13px;
}

.section-label {
  font-size: 10px; font-weight: 600; color: var(--text-4);
  text-transform: uppercase; letter-spacing: 0.08em;
  margin-bottom: 10px;
}

/* Ticket Banner */
.ticket-banner {
  display: flex; align-items: flex-start; gap: 20px;
  padding: 20px; background: var(--bg-1); border: 1px solid var(--border);
  border-radius: var(--radius-lg); margin-bottom: 24px;
}
.banner-left { flex: 1; }
.banner-title-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.banner-id { font-size: 18px; font-weight: 700; color: var(--text-1); font-family: 'JetBrains Mono', monospace; letter-spacing: -0.02em; }
.banner-badge {
  font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px;
}
.banner-badge.running { background: rgba(59,130,246,0.1); color: var(--blue); }
.banner-badge.complete { background: rgba(16,185,129,0.1); color: var(--green); }
.banner-desc { font-size: 13px; color: var(--text-3); line-height: 1.5; margin-bottom: 10px; }
.banner-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.btag {
  font-size: 10px; color: var(--text-4); background: var(--bg-2);
  padding: 2px 8px; border-radius: 4px; font-weight: 500;
}
.banner-score-ring {
  position: relative; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.score-value {
  position: absolute; font-size: 22px; font-weight: 800; color: var(--text-1);
  font-family: 'JetBrains Mono', monospace;
}
.score-label {
  position: absolute; bottom: 4px; font-size: 9px; color: var(--text-4); font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em;
}

/* ─── PIPELINE (Vertical Timeline) ─── */
.pipeline-vertical { display: flex; flex-direction: column; gap: 0; margin-bottom: 8px; }
.pipeline-step { display: flex; gap: 16px; }
.step-timeline { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; width: 32px; }
.step-node {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--node-color); display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: background 0.3s, box-shadow 0.3s;
  z-index: 1;
}
.step-node:has(.node-pulse) { box-shadow: 0 0 12px var(--node-color); }
.node-pulse { width: 10px; height: 10px; border-radius: 50%; animation: pulse 1.5s ease-in-out infinite; }
.node-num { font-size: 11px; font-weight: 700; color: var(--text-4); }
.step-line { flex: 1; width: 2px; background: var(--line-color); min-height: 8px; transition: background 0.3s; }

.step-card {
  flex: 1; padding: 14px 16px; background: var(--bg-1);
  border: 1px solid var(--border); border-radius: var(--radius);
  margin-bottom: 8px; transition: all 0.3s;
}
.step-card.active { border-color: var(--card-accent); background: var(--bg-2); box-shadow: 0 0 20px rgba(59,130,246,0.05); }
.step-header { display: flex; align-items: center; gap: 10px; }
.step-icon-wrap {
  width: 32px; height: 32px; border-radius: 8px;
  background: color-mix(in srgb, var(--icon-bg) 8%, transparent);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.step-info { flex: 1; }
.step-name { font-size: 13px; font-weight: 600; color: var(--text-1); }
.step-params { font-size: 10px; color: var(--text-4); }

/* Status Pill */
.status-pill {
  font-size: 10px; font-weight: 600; padding: 3px 10px; border-radius: 20px;
  display: flex; align-items: center; gap: 4px;
}
.status-pill.queued { color: var(--text-4); background: var(--bg-3); }
.status-pill.active { color: var(--pill-accent); background: rgba(59,130,246,0.1); }
.status-pill.retry { color: var(--amber); background: rgba(245,158,11,0.1); }
.status-pill.done { color: var(--green); background: rgba(16,185,129,0.1); }
.status-pill.error { color: var(--red); background: rgba(239,68,68,0.1); }
.pill-pulse { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: pulse 1.5s ease-in-out infinite; }

/* Ingestion */
.ingest-section { margin-top: 10px; padding: 8px 10px; background: var(--bg-0); border-radius: 6px; }
.ingest-row {
  display: flex; align-items: center; gap: 10px; padding: 3px 0;
  animation: fadeSlide 0.3s ease both; font-size: 11px;
}
.ingest-key { color: var(--text-4); width: 100px; flex-shrink: 0; font-weight: 500; }
.ingest-val { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Thinking */
.thinking-section {
  margin-top: 10px; display: flex; align-items: center; gap: 10px;
  padding: 10px; background: var(--bg-0); border-radius: 6px;
}
.thinking-section.retry { border: 1px solid rgba(245,158,11,0.15); }
.think-animation { display: flex; gap: 3px; align-items: flex-end; height: 16px; }
.think-bar {
  width: 3px; border-radius: 2px; background: var(--blue);
  animation: barPulse 0.8s ease-in-out infinite alternate;
}
.think-label { font-size: 11px; color: var(--text-4); }
.retry-icon { animation: spin 1.5s linear infinite; }

/* Step results (inline) */
.step-results { margin-top: 10px; display: flex; flex-direction: column; gap: 2px; }
.sresult-row {
  display: flex; align-items: center; gap: 8px; padding: 4px 0;
  animation: fadeSlide 0.4s ease both;
}
.sresult-verdict { font-size: 12px; font-weight: 700; width: 16px; text-align: center; }
.sresult-verdict.pass { color: var(--green); }
.sresult-verdict.fail { color: var(--red); }
.sresult-verdict.unknown, .sresult-verdict.error { color: var(--text-4); }
.sresult-name { font-size: 11px; color: var(--text-3); flex: 1; }
.sresult-score { font-size: 11px; font-weight: 600; color: var(--text-2); font-family: 'JetBrains Mono', monospace; }

/* ─── RESULTS TABLE ─── */
.results-table {
  background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius);
  overflow: hidden;
}
.rtable-header {
  display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  background: var(--bg-2); border-bottom: 1px solid var(--border);
  font-size: 10px; font-weight: 600; color: var(--text-4); text-transform: uppercase; letter-spacing: 0.06em;
}
.rth { }
.rrow {
  border-bottom: 1px solid var(--border); padding: 10px 14px; cursor: pointer;
  transition: background 0.15s; animation: fadeSlide 0.3s ease;
}
.rrow:hover { background: var(--bg-2); }
.rrow:last-child { border-bottom: none; }
.rrow-main { display: flex; align-items: center; gap: 8px; }
.rrow-pid { width: 60px; font-size: 11px; font-weight: 600; color: var(--text-4); font-family: 'JetBrains Mono', monospace; flex-shrink: 0; }
.rrow-name { flex: 2; font-size: 12px; color: var(--text-2); }
.rrow-verdict {
  width: 70px; flex-shrink: 0; font-size: 10px; font-weight: 700;
  padding: 2px 8px; border-radius: 4px; text-align: center;
}
.rrow-verdict.pass { color: var(--green); background: rgba(16,185,129,0.1); }
.rrow-verdict.fail { color: var(--red); background: rgba(239,68,68,0.1); }
.rrow-verdict.unknown, .rrow-verdict.error { color: var(--text-4); background: var(--bg-3); }
.rrow-score { width: 50px; flex-shrink: 0; font-size: 12px; font-weight: 700; color: var(--text-1); font-family: 'JetBrains Mono', monospace; }
.score-max { font-weight: 400; color: var(--text-4); }
.rrow-reasoning { flex: 3; font-size: 11px; color: var(--text-4); line-height: 1.4; }
.rrow-evidence {
  margin-top: 8px; padding: 10px 12px; background: var(--bg-0); border-radius: 6px;
  margin-left: 60px;
}
.evidence-label { font-size: 9px; font-weight: 600; color: var(--text-4); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
.evidence-item {
  font-size: 11px; color: var(--text-3); font-style: italic;
  border-left: 2px solid var(--blue); padding-left: 10px; margin-bottom: 4px; line-height: 1.5;
}

/* ─── SUMMARY GRID ─── */
.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.summary-card {
  padding: 16px; background: var(--bg-1); border: 1px solid var(--border);
  border-radius: var(--radius); text-align: center;
}
.sc-value { font-size: 28px; font-weight: 800; color: var(--text-1); font-family: 'JetBrains Mono', monospace; }
.sc-value.pass { color: var(--green); }
.sc-value.fail { color: var(--red); }
.sc-value.score { color: var(--amber); }
.sc-label { font-size: 10px; color: var(--text-4); font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }

/* ─── GLOBAL SUMMARY BAR ─── */
.global-summary {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 0; margin-top: 24px; border-top: 1px solid var(--border);
}
.gs-stats { display: flex; gap: 24px; }
.gs-item { text-align: center; }
.gs-num { font-size: 20px; font-weight: 800; font-family: 'JetBrains Mono', monospace; display: block; }
.gs-lbl { font-size: 9px; color: var(--text-4); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; }
.gs-actions { display: flex; gap: 8px; }

/* ═══════════════════════════════════════════
   DEBUG DRAWER
   ═══════════════════════════════════════════ */
.debug-drawer {
  border-left: 1px solid var(--border); overflow: hidden;
  display: flex; flex-direction: column;
  background: var(--bg-0);
  width: 0; opacity: 0; transition: opacity 0.3s;
}
.debug-drawer.open { width: auto; opacity: 1; }

.drawer-tabs {
  display: flex; border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.drawer-tab {
  flex: 1; padding: 10px 8px; font-size: 10px; font-weight: 600;
  color: var(--text-4); background: none; border: none; cursor: pointer;
  border-bottom: 2px solid transparent; transition: all 0.15s;
  font-family: inherit; white-space: nowrap;
}
.drawer-tab:hover { color: var(--text-3); }
.drawer-tab.active { color: var(--blue); border-bottom-color: var(--blue); }

.drawer-body { flex: 1; overflow-y: auto; padding: 8px; }
.drawer-context {
  font-size: 10px; font-weight: 600; padding: 6px 8px;
  margin-bottom: 4px; background: var(--bg-1); border-radius: 4px;
}
.drawer-empty { padding: 24px 12px; text-align: center; font-size: 11px; color: var(--text-4); }
.cot-text {
  font-size: 11px; line-height: 1.6; color: var(--text-3);
  white-space: pre-wrap; word-break: break-word;
  font-family: 'JetBrains Mono', monospace; margin: 0;
}

/* Event log */
.event-row { display: flex; align-items: center; gap: 6px; padding: 2px 4px; font-size: 10px; }
.evt-time { color: var(--text-4); width: 60px; flex-shrink: 0; font-family: 'JetBrains Mono', monospace; font-size: 9px; }
.evt-type { font-weight: 600; font-size: 9px; }
.evt-detail { color: var(--text-4); font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* LLM Log Entries */
.llm-entry {
  border-bottom: 1px solid var(--border); padding: 6px 4px;
  cursor: pointer; transition: background 0.15s;
  animation: fadeSlide 0.3s ease;
}
.llm-entry:hover { background: var(--bg-1); }
.llm-row { display: flex; align-items: center; gap: 6px; }
.llm-time { font-size: 9px; color: var(--text-4); width: 56px; flex-shrink: 0; font-family: 'JetBrains Mono', monospace; }
.llm-badge {
  font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 3px;
  white-space: nowrap;
}
.llm-badge.req { color: var(--orange); background: rgba(249,115,22,0.1); }
.llm-badge.res { color: var(--green); background: rgba(16,185,129,0.1); }
.llm-badge.err { color: var(--red); background: rgba(239,68,68,0.1); }
.llm-badge.warn { color: var(--amber); background: rgba(245,158,11,0.1); }
.llm-target { font-size: 10px; font-weight: 600; color: var(--text-3); white-space: nowrap; }
.llm-meta { font-size: 9px; color: var(--text-4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.llm-meta.ok { color: var(--green); }
.llm-meta.err { color: var(--red); }
.llm-meta.warn { color: var(--amber); }
.llm-expand { margin-left: auto; font-size: 9px; color: var(--text-4); flex-shrink: 0; }

.llm-detail { margin-top: 6px; padding: 8px; background: var(--bg-1); border-radius: 6px; }
.llm-section-label { font-size: 9px; font-weight: 600; color: var(--text-4); text-transform: uppercase; letter-spacing: 0.05em; margin: 6px 0 3px; }
.llm-section-label:first-child { margin-top: 0; }
.llm-pre {
  font-size: 10px; line-height: 1.5; color: var(--text-3);
  white-space: pre-wrap; word-break: break-word;
  font-family: 'JetBrains Mono', monospace; margin: 0;
  max-height: 200px; overflow-y: auto;
}
.llm-pre.err { color: var(--red); }
.llm-verdicts { display: flex; gap: 8px; flex-wrap: wrap; }
.llm-v { font-size: 10px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
.llm-v.pass { color: var(--green); }
.llm-v.fail { color: var(--red); }
.llm-v.unknown { color: var(--text-4); }

/* ═══════════════════════════════════════════
   ANIMATIONS
   ═══════════════════════════════════════════ */
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes fadeSlide { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes barPulse {
  0% { height: 4px; opacity: 0.4; }
  100% { height: 14px; opacity: 1; }
}
`;
document.head.appendChild(styleEl);