import { useState, useEffect, useRef, useCallback } from "react";
import {
  Clock, Volume2, Square, Mic, Send, ChevronLeft,
  Building2, AlertTriangle, CheckCircle2, Radio
} from "lucide-react";
import { api } from "./api.js";

const CRIT = 180, WARN = 480;
const pad = (n) => String(n).padStart(2, "0");
const fmt = (s) => `${pad(Math.floor(Math.max(0, s) / 60))}:${pad(Math.max(0, s) % 60)}`;
const tier = (s) => (s <= 0 ? "breach" : s < CRIT ? "crit" : s < WARN ? "warn" : "safe");
const useTick = () => { const [, s] = useState(0); useEffect(() => { const t = setInterval(() => s((n) => n + 1), 1000); return () => clearInterval(t); }, []); return Date.now(); };

export default function App() {
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => { api.users().then(setUsers).catch((e) => setErr(String(e.message))); }, []);
  const load = useCallback(() => { api.queue().then(setTickets).catch((e) => setErr(String(e.message))); }, []);
  useEffect(() => { if (me) load(); }, [me, load]);

  if (!me) return <SignIn users={users} onPick={setMe} err={err} />;

  const open = tickets.find((x) => x.id === openId) || null;
  const markSent = (id, left) => setTickets((l) => l.map((x) => (x.id === id ? { ...x, sentAt: Date.now(), savedWith: left } : x)));

  return (
    <div className="er-root">
      {open
        ? <Ticket ticket={open} me={me} onBack={() => { setOpenId(null); load(); }} onSent={markSent} />
        : <Queue tickets={tickets} me={me} onOpen={setOpenId} err={err} />}
    </div>
  );
}

function SignIn({ users, onPick, err }) {
  return (
    <div className="er-root er-signin">
      <Radio size={26} />
      <h1>First Response</h1>
      <p>Enterprise Elite · responses are posted as you</p>
      {err && <div className="er-err">{err}</div>}
      <div className="er-userlist">
        {users.map((u) => (
          <button key={u.id} className="er-btn er-btn-ghost" onClick={() => onPick(u)}>{u.name}</button>
        ))}
        {users.length === 0 && !err && <span className="er-words">Loading roster…</span>}
      </div>
    </div>
  );
}

function Queue({ tickets, me, onOpen, err }) {
  const t = useTick();
  const pending = tickets.filter((x) => !x.sentAt).sort((a, b) => a.deadline - b.deadline);
  const done = tickets.filter((x) => x.sentAt);
  return (
    <>
      <header className="er-top">
        <div className="er-eyebrow"><Radio size={13} /> Enterprise Elite · first response</div>
        <div className="er-id"><span className="er-avatar">{initials(me.name)}</span><span>{me.name}</span></div>
      </header>
      <div className="er-scroll">
        {err && <div className="er-err">{err}</div>}
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
              <div className="er-card-foot">
                <span className="er-chan">{x.channel}</span>
                <span className={`er-chip er-${k}`}>{k === "breach" ? <AlertTriangle size={13} /> : <Clock size={13} />}{k === "breach" ? "BREACHED" : fmt(left)}</span>
              </div>
            </button>
          );
        })}
        {done.length > 0 && <div className="er-section">Responded</div>}
        {done.map((x) => (
          <div key={x.id} className="er-card er-card-done">
            <div className="er-card-head"><span className="er-acct"><Building2 size={14} />{x.account}</span>
              <span className="er-chip er-safe"><CheckCircle2 size={13} />{fmt(x.savedWith)} to spare</span></div>
            <div className="er-subj er-muted">{x.subject}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function Ticket({ ticket, me, onBack, onSent }) {
  const t = useTick();
  const left = Math.round((ticket.deadline - t) / 1000), k = tier(left);
  const [summary, setSummary] = useState(ticket.summary || "");
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
        <div className="er-clock-wrap"><span className="er-clock-label">first response due in</span>
          <span className="er-clock">{k === "breach" ? "BREACHED" : fmt(left)}</span></div>
        <div className="er-clock-acct">{ticket.account}<br /><a href={`https://app.usepylon.com/support/issues/views/all-issues?issueNumber=${ticket.number || ""}&view=fs`} target="_blank" rel="noopener noreferrer">#{ticket.number || ticket.id}</a></div>
      </div>
      <div className="er-scroll er-ticket">
        <div className="er-meta">
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
