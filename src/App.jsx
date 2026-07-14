import { useState, useEffect, useRef, useCallback } from "react";
import {
  Clock, Volume2, Square, Mic, Send, ChevronLeft,
  Building2, AlertTriangle, CheckCircle2, Radio
} from "lucide-react";
import { api } from "./api.js";

const CRIT = 180, WARN = 480;
const pad = (n) => String(n).padStart(2, "0");
const fmt = (s) => `${pad(Math.floor(Math.max(0, s) / 60))}:${pad(Math.max(0, s) % 60)}`;
const fmtBreach = (s) => { const abs = Math.abs(s); const m = Math.floor(abs / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${pad(abs % 60)}s`; };
const tier = (s) => (s <= 0 ? "breach" : s < CRIT ? "crit" : s < WARN ? "warn" : "safe");
const ago = (ms) => { if (!ms || isNaN(ms)) return ""; const s = Math.floor((Date.now() - ms) / 1000); if (s < 60) return "just now"; const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ${m % 60}m ago`; return `${Math.floor(h / 24)}d ago`; };
const useTick = () => { const [, s] = useState(0); useEffect(() => { const t = setInterval(() => s((n) => n + 1), 1000); return () => clearInterval(t); }, []); return Date.now(); };

const MOCK = import.meta.env.VITE_USE_MOCK === "true";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000;

export default function App() {
  const [me, setMe] = useState(null);
  const [validating, setValidating] = useState(true);
  const [tickets, setTickets] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [err, setErr] = useState("");

  const handleAuth = useCallback(async (user) => {
    const persisted = { ...user, _loginAt: Date.now() };
    try { localStorage.setItem("fr_user", JSON.stringify(persisted)); } catch {}
    setMe(persisted);
  }, []);

  const getSentMap = () => {
    try { return new Map(Object.entries(JSON.parse(localStorage.getItem("fr_sent") || "{}"))); } catch { return new Map(); }
  };

  const load = useCallback(() => {
    api.queue().then((t) => {
      const sent = getSentMap();
      const merged = t.map((x) => sent.has(x.id) ? { ...x, sentAt: sent.get(x.id).sentAt, savedWith: sent.get(x.id).savedWith } : x);
      setTickets(merged);
      if (!openId) {
        const params = new URLSearchParams(window.location.search);
        const linked = params.get("issue");
        if (linked && t.some((x) => x.id === linked)) {
          setOpenId(linked);
          window.history.replaceState({}, "", window.location.pathname);
        }
      }
    }).catch((e) => setErr(String(e.message)));
  }, [openId]);
  useEffect(() => { if (me) load(); }, [me, load]);

  // Validate stored identity on mount
  useEffect(() => {
    const validateSession = async () => {
      try {
        const stored = JSON.parse(localStorage.getItem("fr_user"));
        if (!stored) { setValidating(false); return; }
        const age = Date.now() - (stored._loginAt || 0);
        if (age > SESSION_MAX_MS) {
          try { localStorage.removeItem("fr_user"); } catch {}
          setValidating(false);
          return;
        }
        // Validate the stored user still exists on the server
        const validated = await api.validateUser(stored.id);
        if (validated) {
          setMe(stored);
        } else {
          try { localStorage.removeItem("fr_user"); } catch {}
        }
      } catch (e) {
        console.warn("Session validation failed:", e);
        try { localStorage.removeItem("fr_user"); } catch {}
      } finally {
        setValidating(false);
      }
    };
    validateSession();
  }, []);

  // Listen for sign-out in other tabs
  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === "fr_user" && e.newValue === null) {
        setMe(null);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  if (validating) return <div className="er-root er-signin"><Radio size={26} /><h1>First Response</h1><p className="er-words">Validating session…</p></div>;
  if (!me) return <SignIn onAuth={handleAuth} />;

  const signOut = () => {
    try {
      localStorage.removeItem("fr_user");
    } catch (e) {
      console.warn("Failed to remove fr_user from localStorage:", e);
    }
    setMe(null);
  };
  const open = tickets.find((x) => x.id === openId) || null;
  const markSent = (id, left) => {
    const entry = { sentAt: Date.now(), savedWith: left };
    try {
      // Re-read immediately before write to avoid overwriting concurrent tab changes
      const stored = JSON.parse(localStorage.getItem("fr_sent") || "{}");
      stored[id] = entry;
      localStorage.setItem("fr_sent", JSON.stringify(stored));
      // Only update state after successful persistence
      setTickets((l) => l.map((x) => (x.id === id ? { ...x, ...entry } : x)));
    } catch (e) {
      console.error("Failed to persist sent status:", e);
    }
  };

  return (
    <div className="er-root">
      {open
        ? <Ticket ticket={open} me={me} onBack={() => { setOpenId(null); load(); }} onSent={markSent} />
        : <Queue tickets={tickets} me={me} onOpen={setOpenId} onSignOut={signOut} err={err} />}
    </div>
  );
}

function SignIn({ onAuth }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [gisReady, setGisReady] = useState(false);
  const btnRef = useRef(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (MOCK) { api.googleAuth(null).then(onAuth); return; }

    if (!GOOGLE_CLIENT_ID) {
      setErr("VITE_GOOGLE_CLIENT_ID not configured");
      return;
    }

    // Wait for Google Identity Services to load (max 10 seconds)
    let elapsed = 0;
    const checkGIS = () => {
      if (window.google?.accounts?.id) {
        setGisReady(true);
      } else if (elapsed >= 10000) {
        setErr("Google Sign-In failed to load. Please refresh the page.");
      } else {
        elapsed += 100;
        timeoutRef.current = setTimeout(checkGIS, 100);
      }
    };
    checkGIS();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [onAuth]);

  useEffect(() => {
    if (!gisReady || MOCK) return;

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response) => {
        setBusy(true); setErr("");
        try {
          const result = await api.googleAuth(response.credential);
          onAuth(result.user);
        } catch (e) { setErr(String(e.message)); setBusy(false); }
      },
    });

    if (btnRef.current) {
      window.google.accounts.id.renderButton(btnRef.current, {
        theme: "filled_blue", size: "large", shape: "pill", text: "signin_with", width: 280,
      });
    }
  }, [gisReady, onAuth]);

  return (
    <div className="er-root er-signin">
      <Radio size={26} />
      <h1>First Response</h1>
      <p>Enterprise Elite · sign in to respond as you</p>
      {err && <div className="er-err">{err}</div>}
      {busy ? <span className="er-words">Verifying…</span> : <div ref={btnRef} className="er-google-btn" />}
    </div>
  );
}

function Queue({ tickets, me, onOpen, onSignOut, err }) {
  const t = useTick();
  const [tab, setTab] = useState("pending");
  const pending = tickets.filter((x) => !x.sentAt).sort((a, b) => a.deadline - b.deadline);
  const done = tickets.filter((x) => x.sentAt).sort((a, b) => b.sentAt - a.sentAt);
  return (
    <>
      <header className="er-top">
        <div className="er-eyebrow"><Radio size={13} /> Enterprise Elite · first response</div>
        <button className="er-id" onClick={onSignOut} title="Sign out"><span className="er-avatar">{initials(me.name)}</span><span>{me.name}</span></button>
      </header>
      <div className="er-tabs">
        <button className={`er-tab ${tab === "pending" ? "er-tab-on" : ""}`} onClick={() => setTab("pending")}>Pending{pending.length > 0 && ` (${pending.length})`}</button>
        <button className={`er-tab ${tab === "archive" ? "er-tab-on" : ""}`} onClick={() => setTab("archive")}>Archive{done.length > 0 && ` (${done.length})`}</button>
      </div>
      <div className="er-scroll">
        {err && <div className="er-err">{err}</div>}
        {tab === "pending" && <>
          {pending.length === 0 && !err && (
            <div className="er-empty"><CheckCircle2 size={28} /><p>Nothing waiting. Every Enterprise Elite ticket has a first response.</p></div>
          )}
          {pending.map((x) => {
            const left = Math.round((x.deadline - t) / 1000), k = tier(left);
            return (
              <button key={x.id} className="er-card" onClick={() => onOpen(x.id)}>
                <div className="er-card-head">
                  <span className="er-acct"><Building2 size={14} />{x.account}</span>
                  {x.paged && <span className="er-pd">PAGED</span>}
                </div>
                <div className="er-subj">{x.subject}</div>
                <div className="er-card-meta"><span className="er-chan">{x.channel}</span><span className="er-created">{ago(new Date(x.createdAt).getTime())}</span></div>
                <div className="er-card-foot">
                  <span className={`er-chip er-${k}`}>{k === "breach" ? <AlertTriangle size={13} /> : <Clock size={13} />}{k === "breach" ? `BREACHED +${fmtBreach(left)}` : fmt(left)}</span>
                </div>
              </button>
            );
          })}
        </>}
        {tab === "archive" && <>
          {done.length === 0 && (
            <div className="er-empty"><CheckCircle2 size={28} /><p>No archived responses yet.</p></div>
          )}
          {done.map((x) => (
            <div key={x.id} className="er-card er-card-done">
              <div className="er-card-head"><span className="er-acct"><Building2 size={14} />{x.account}</span>
                <span className="er-chip er-safe"><CheckCircle2 size={13} />{x.savedWith > 0 ? `${fmt(x.savedWith)} to spare` : "Breached"}</span></div>
              <div className="er-subj er-muted">{x.subject}</div>
            </div>
          ))}
        </>}
      </div>
    </>
  );
}

function Ticket({ ticket, me, onBack, onSent }) {
  const t = useTick();
  const left = Math.round((ticket.deadline - t) / 1000), k = tier(left);
  const [summary, setSummary] = useState("");
  const [text, setText] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [frozenLeft, setFrozenLeft] = useState(null);
  const recRef = useRef(null), baseRef = useRef("");

  useEffect(() => { api.summarize(ticket.id, ticket.summary).then(setSummary).catch(() => {}); }, [ticket.id, ticket.summary]);

  const toggleSpeak = useCallback(() => {
    const synth = window.speechSynthesis; if (!synth) return;
    if (synth.speaking) { synth.cancel(); setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(`${ticket.account}. ${summary}`);
    u.rate = 1.05; u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false);
    setSpeaking(true); synth.speak(u);
  }, [ticket.account, summary]);

  const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const toggleListen = () => {
    if (!SR) return;
    if (listening) { recRef.current?.stop(); return; }
    const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = "en-US";
    baseRef.current = text ? text + " " : "";
    r.onresult = (e) => { let s = ""; for (let i = e.resultIndex; i < e.results.length; i++) s += e.results[i][0].transcript; setText(baseRef.current + s); };
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    recRef.current = r; setListening(true); r.start();
  };

  useEffect(() => () => { window.speechSynthesis?.cancel(); recRef.current?.stop(); }, []);

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const ready = words >= 3 && !sent && !busy;

  const send = async () => {
    if (!ready) return;
    setBusy(true); setErr("");
    window.speechSynthesis?.cancel(); recRef.current?.stop();
    try {
      await api.respond({ issueId: ticket.id, body: text.trim(), userId: me.id, incidentId: ticket.incidentId });
      setFrozenLeft(Math.max(0, left)); setSent(true); onSent(ticket.id, Math.max(0, left));
    } catch (e) { setErr(String(e.message)); setBusy(false); }
  };

  if (sent) return (
    <div className="er-sent">
      <CheckCircle2 size={44} />
      <h2>First response posted</h2>
      <p>Posted as {me.name} · clock stopped with <b>{fmt(frozenLeft)}</b> to spare</p>
      <button className="er-btn er-btn-ghost" onClick={onBack}>Back to queue</button>
    </div>
  );

  return (
    <>
      <div className={`er-clockbar er-${k}`}>
        <button className="er-back" onClick={onBack}><ChevronLeft size={20} /></button>
        <div className="er-clock-wrap"><span className="er-clock-label">{k === "breach" ? "breached by" : "first response due in"}</span>
          <span className="er-clock">{k === "breach" ? `+${fmtBreach(left)}` : fmt(left)}</span></div>
        <div className="er-clock-acct">{ticket.account}<br /><a href={`https://app.usepylon.com/support/issues/views/all-issues?issueNumber=${ticket.number || ""}&view=fs`} target="_blank" rel="noopener noreferrer">#{ticket.number || ticket.id}</a></div>
      </div>
      <div className="er-scroll er-ticket">
        <div className="er-meta">
          <div>Created: {ago(new Date(ticket.createdAt).getTime())}</div>
          <div>Requester: {ticket.customer}</div>
          <div>Assignee: {ticket.assignee || "Unassigned"}</div>
          <div>Source: {ticket.channel}</div>
        </div>
        <div className="er-summary">
          <div className="er-summary-top"><span className="er-summary-tag">Problem</span>
            <button className="er-speak" onClick={toggleSpeak}>{speaking ? <Square size={14} /> : <Volume2 size={16} />}{speaking ? "Stop" : "Read aloud"}</button></div>
          <p>{summary || "Summarizing…"}</p>
        </div>
        <label className="er-compose-label">Your first response — original, in your words</label>
        <div className="er-compose">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5}
            placeholder="Tap the mic on your keyboard and speak, or type…" />
          <div className="er-compose-foot">
            <button className={`er-mic ${listening ? "er-mic-on" : ""}`} onClick={toggleListen} disabled={!SR}
              title={SR ? "Dictate" : "Use your keyboard's mic"}>
              <Mic size={16} />{listening ? "Listening…" : SR ? "Dictate" : "Keyboard mic"}</button>
            <span className="er-words">{words} words</span>
          </div>
        </div>
        {err && <div className="er-err">{err}</div>}
      </div>
      <div className="er-send-bar">
        <button className="er-btn er-btn-send" disabled={!ready} onClick={send}>
          <Send size={17} /> {busy ? "Sending…" : "Send first response"}</button>
        {!ready && !busy && <span className="er-hint">Write at least a sentence to send</span>}
      </div>
    </>
  );
}

const initials = (n) => (n || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
