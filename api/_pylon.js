// Shared Pylon REST helpers. The backend holds the admin token; the browser never sees it.
const BASE = "https://api.usepylon.com";

const TOKEN = process.env.PYLON_API_TOKEN;
const TIER_SLUG = process.env.PYLON_TIER_FIELD_SLUG || "support_tier";
const TIER_VALUES = (process.env.PYLON_TIER_VALUE || "Enterprise Elite").split(",").map((s) => s.trim()).filter(Boolean);
const PRIORITY_SLUG = process.env.PYLON_PRIORITY_FIELD_SLUG || "priority";
const PRIORITY_VALUE = process.env.PYLON_PRIORITY_VALUE || "Urgent";
const TEAM_ID = process.env.PYLON_TEAM_ID || "";
const BOT_IDS = (process.env.PYLON_BOT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

function headers() {
  return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
}

async function pylon(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pylon ${path} ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// A ticket needs a first response when no message qualifies as an agent reply:
//   is_private === false  AND  from_customer === false  AND  author not a bot
export function needsFirstResponse(messages = []) {
  return !messages.some(
    (m) =>
      m.is_private === false &&
      m.from_customer === false &&
      !BOT_IDS.includes(m.author?.id || m.user_id)
  );
}

// Open Enterprise Elite / Pinnacle Urgent issues assigned to the team, still awaiting first response.
// Pylon REST API doesn't support custom_field_filters, so we fetch issues in small
// batches and filter locally after fetching full details.
export async function listEliteAwaitingFirstResponse() {
  const slaMs = Number(process.env.SLA_MINUTES || 15) * 60000;

  const filters = [
    { field: "state", operator: "in", values: ["new"] },
    { field: TIER_SLUG, operator: "in", values: TIER_VALUES.map((v) => v.toLowerCase().replace(/\s+/g, "_")) },
    { field: PRIORITY_SLUG, operator: "equals", value: PRIORITY_VALUE.toLowerCase() },
  ];
  if (TEAM_ID) filters.push({ field: "team_id", operator: "equals", value: TEAM_ID });

  const searchBody = {
    filter: { operator: "and", subfilters: filters },
    limit: 25,
  };

  let issues = [];
  try {
    const res = await pylon(`/issues/search`, {
      method: "POST",
      body: JSON.stringify(searchBody),
    });
    issues = res.data || res.issues || (Array.isArray(res) ? res : []);
  } catch (e) {
    throw new Error(`Failed to search issues: ${e.message}`);
  }

  const out = [];
  for (const issue of issues) {
    if (out.length >= 10) break;
    let detail;
    try {
      const full = await pylon(`/issues/${issue.id}`);
      detail = full.data || full;
    } catch (e) {
      continue;
    }
    if (detail.first_response_time) continue;

    let accountName = detail.account?.name || "";
    if (!accountName && detail.account?.id) {
      try {
        const acc = await pylon(`/accounts/${detail.account.id}`);
        accountName = (acc.data || acc).name || "";
      } catch (e) { /* proceed without name */ }
    }

    let requesterName = detail.requester?.name || "";
    if (!requesterName && detail.requester?.id) {
      try {
        const req = await pylon(`/contacts/${detail.requester.id}`);
        requesterName = (req.data || req).name || "";
      } catch (e) { /* proceed without name */ }
    }

    let assigneeName = detail.assignee?.name || "";
    if (!assigneeName && detail.assignee?.id) {
      try {
        const usr = await pylon(`/users/${detail.assignee.id}`);
        assigneeName = (usr.data || usr).name || "";
      } catch (e) { /* proceed without name */ }
    }

    let messages = [];
    try {
      const msgRes = await pylon(`/issues/${issue.id}/messages`);
      messages = msgRes.data || [];
    } catch (e) { /* proceed without thread */ }

    const source = (detail.source || issue.channel || "—");

    out.push({
      id: issue.id,
      number: detail.number || issue.number,
      account: accountName || "Unknown account",
      customer: requesterName || "Customer",
      assignee: assigneeName || "",
      channel: source.charAt(0).toUpperCase() + source.slice(1),
      subject: detail.title || issue.subject || "(no subject)",
      createdAt: detail.created_at || issue.created_at,
      deadline: new Date(detail.created_at || issue.created_at).getTime() + slaMs,
      summary: (detail.body_text || detail.body_html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      thread: [
        ...(detail.body_text || detail.body_html ? [{ from: "customer", body: detail.body_text || detail.body_html }] : []),
        ...messages.map((m) => ({ from: m.from_customer ? "customer" : "agent", body: m.body_text || m.body_html || m.message_html || "" })),
      ],
    });
  }
  return out.sort((a, b) => a.deadline - b.deadline);
}

export async function getIssueThread(issueId) {
  const issue = await pylon(`/issues/${issueId}`);
  const { data: messages = [] } = await pylon(`/issues/${issueId}/messages`);
  return { issue, messages };
}

// Post the engineer's ORIGINAL first response, authored by them (user_id),
// so the SLA record credits the live person rather than the API token's identity.
export async function postFirstResponse({ issueId, body, userId }) {
  const [{ data: messages = [] }, issueRes] = await Promise.all([
    pylon(`/issues/${issueId}/messages`),
    pylon(`/issues/${issueId}`),
  ]);
  const lastMsg = messages.filter((m) => !m.is_private).pop();
  if (!lastMsg) throw new Error("No public messages found on issue to reply to");

  const issue = issueRes.data || issueRes;
  const replyBody = {
    body_html: body,
    message_id: lastMsg.id,
    user_id: userId,
  };

  if (issue.source === "email") {
    let requesterEmail = issue.requester?.email;
    if (!requesterEmail && issue.requester?.id) {
      try {
        const contact = await pylon(`/contacts/${issue.requester.id}`);
        requesterEmail = (contact.data || contact).email;
      } catch {}
    }
    if (!requesterEmail) throw new Error("Email issue has no requester email — cannot send reply");
    replyBody.to = [requesterEmail];
  }

  return pylon(`/issues/${issueId}/reply`, {
    method: "POST",
    body: JSON.stringify(replyBody),
  });
}

export async function debugQueue() {
  const filters = [
    { field: "state", operator: "in", values: ["new"] },
    { field: TIER_SLUG, operator: "in", values: TIER_VALUES.map((v) => v.toLowerCase().replace(/\s+/g, "_")) },
    { field: PRIORITY_SLUG, operator: "equals", value: PRIORITY_VALUE.toLowerCase() },
  ];
  if (TEAM_ID) filters.push({ field: "team_id", operator: "equals", value: TEAM_ID });
  const searchBody = { filter: { operator: "and", subfilters: filters }, limit: 10 };

  let raw, issues = [], searchError = null;
  try {
    raw = await pylon(`/issues/search`, { method: "POST", body: JSON.stringify(searchBody) });
    issues = raw.data || raw.issues || (Array.isArray(raw) ? raw : []);
  } catch (e) {
    searchError = e.message;
  }
  return {
    searchBody, searchError, TEAM_ID,
    issueCount: issues.length,
    issues: issues.map((i) => ({ id: i.id, number: i.number, title: i.title, state: i.state })),
    config: { TIER_SLUG, TIER_VALUES, PRIORITY_SLUG, PRIORITY_VALUE },
  };
}

export async function listUsers() {
  const { data = [] } = await pylon(`/users`);
  return data.map((u) => ({ id: u.id, name: u.name, email: u.email }));
}
