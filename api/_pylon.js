// Shared Pylon REST helpers. The backend holds the admin token; the browser never sees it.
const BASE = "https://api.usepylon.com";

const TOKEN = process.env.PYLON_API_TOKEN;
const TIER_SLUG = process.env.PYLON_TIER_FIELD_SLUG || "support_tier";
const TIER_VALUE = process.env.PYLON_TIER_VALUE || "Enterprise Elite";
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

function tierMatches(issue) {
  const fields = issue.custom_fields || {};
  // custom_fields may be an object keyed by slug or an array of {slug,value}
  if (Array.isArray(fields)) {
    return fields.some((f) => f.slug === TIER_SLUG && (f.value === TIER_VALUE || (f.values || []).includes(TIER_VALUE)));
  }
  const v = fields[TIER_SLUG];
  return v?.value === TIER_VALUE || (v?.values || []).includes(TIER_VALUE) || v === TIER_VALUE;
}

// Open Enterprise Elite issues still awaiting a first response.
export async function listEliteAwaitingFirstResponse() {
  // Pull open issues, then filter by the support_tier CUSTOM FIELD (not tags —
  // tag search misses Elite tickets where the tier only lives in this field).
  const { data: issues = [] } = await pylon(`/issues?status=open&limit=100`);
  const elite = issues.filter(tierMatches);

  const out = [];
  for (const issue of elite) {
    const { data: messages = [] } = await pylon(`/issues/${issue.id}/messages`);
    if (needsFirstResponse(messages)) {
      out.push({
        id: issue.id,
        account: issue.account?.name || "Unknown account",
        customer: issue.requester?.name || issue.contact?.name || "Customer",
        channel: issue.source || issue.channel || "—",
        subject: issue.title || issue.subject || "(no subject)",
        createdAt: issue.created_at,
        // SLA deadline = created + SLA window (swap for your real SLA policy start if different)
        deadline: new Date(issue.created_at).getTime() + Number(process.env.SLA_MINUTES || 15) * 60000,
        thread: messages.map((m) => ({ from: m.from_customer ? "customer" : "agent", body: m.body_text || m.body_html })),
      });
    }
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

export async function listUsers() {
  const { data = [] } = await pylon(`/users`);
  return data.map((u) => ({ id: u.id, name: u.name, email: u.email }));
}
