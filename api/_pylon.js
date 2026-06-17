// Shared Pylon REST helpers. The backend holds the admin token; the browser never sees it.
const BASE = "https://api.usepylon.com";

const TOKEN = process.env.PYLON_API_TOKEN;
const TIER_SLUG = process.env.PYLON_TIER_FIELD_SLUG || "support_tier";
const TIER_VALUE = process.env.PYLON_TIER_VALUE || "Enterprise Elite";
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

function fieldMatches(issue, slug, target) {
  const fields = issue.custom_fields || {};
  if (Array.isArray(fields)) {
    return fields.some((f) => f.slug === slug && (
      f.value === target || (f.values || []).includes(target) ||
      f.interpreted_value === target || (f.interpreted_values || []).includes(target)
    ));
  }
  const v = fields[slug];
  if (!v || typeof v !== "object") return v === target;
  return v.value === target || (v.values || []).includes(target) ||
    v.interpreted_value === target || (v.interpreted_values || []).includes(target);
}

function isEliteP0(issue) {
  return fieldMatches(issue, TIER_SLUG, TIER_VALUE) && fieldMatches(issue, PRIORITY_SLUG, PRIORITY_VALUE);
}

// Open Enterprise Elite Urgent issues still awaiting a first response.
// Uses server-side filtering to minimize API calls and avoid rate limits.
export async function listEliteAwaitingFirstResponse() {
  const slaMs = Number(process.env.SLA_MINUTES || 15) * 60000;

  const searchBody = {
    states: ["new"],
    custom_field_filters: [
      { field: TIER_SLUG, operator: "equals", value: TIER_VALUE.toLowerCase().replace(/\s+/g, "_") },
      { field: PRIORITY_SLUG, operator: "equals", value: PRIORITY_VALUE.toLowerCase() },
    ],
    limit: 25,
  };
  if (TEAM_ID) searchBody.team_id = TEAM_ID;

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
    let detail;
    try {
      const full = await pylon(`/issues/${issue.id}`);
      detail = full.data || full;
    } catch (e) {
      continue;
    }
    if (detail.first_response_time) continue;

    let messages = [];
    try {
      const msgRes = await pylon(`/issues/${issue.id}/messages`);
      messages = msgRes.data || [];
    } catch (e) { /* proceed without thread */ }

    out.push({
      id: issue.id,
      account: detail.account?.name || "Unknown account",
      customer: detail.requester?.name || detail.contact?.name || "Customer",
      channel: detail.source || issue.channel || "—",
      subject: detail.title || issue.subject || "(no subject)",
      createdAt: detail.created_at || issue.created_at,
      deadline: new Date(detail.created_at || issue.created_at).getTime() + slaMs,
      thread: messages.map((m) => ({ from: m.from_customer ? "customer" : "agent", body: m.body_text || m.body_html })),
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
  return pylon(`/issues/${issueId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      body_html: body,
      is_private: false,
      from_customer: false,
      user_id: userId, // <-- attribution to the live engineer
    }),
  });
}

export async function debugQueue() {
  const searchBody = {
    states: ["new"],
    custom_field_filters: [
      { field: TIER_SLUG, operator: "equals", value: TIER_VALUE.toLowerCase().replace(/\s+/g, "_") },
      { field: PRIORITY_SLUG, operator: "equals", value: PRIORITY_VALUE.toLowerCase() },
    ],
    limit: 10,
  };
  let raw, issues = [], sample = null, searchError = null;
  try {
    raw = await pylon(`/issues/search`, { method: "POST", body: JSON.stringify(searchBody) });
    issues = raw.data || raw.issues || (Array.isArray(raw) ? raw : []);
  } catch (e) {
    searchError = e.message;
  }
  if (issues.length > 0) {
    try {
      const full = await pylon(`/issues/${issues[0].id}`);
      sample = full.data || full;
    } catch (e) { sample = { error: e.message }; }
  }
  return {
    searchBody, searchError,
    rawKeys: raw ? Object.keys(raw) : null,
    issueCount: issues.length,
    issueIds: issues.map((i) => ({ id: i.id, title: i.title, state: i.state })),
    sampleDetail: sample ? { id: sample.id, custom_fields: sample.custom_fields, first_response_time: sample.first_response_time } : null,
    config: { TIER_SLUG, TIER_VALUE, PRIORITY_SLUG, PRIORITY_VALUE },
  };
}

export async function listUsers() {
  const { data = [] } = await pylon(`/users`);
  return data.map((u) => ({ id: u.id, name: u.name, email: u.email }));
}
