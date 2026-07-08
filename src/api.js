// Client API. With VITE_USE_MOCK=true the UI runs standalone (no backend/secrets).
const MOCK = import.meta.env.VITE_USE_MOCK === "true";
const now = Date.now();

const MOCK_USERS = [{ id: "u_joon", name: "Joon Go", email: "joon@coderabbit.ai" }];
const MOCK_TICKETS = [
  { id: "ISS-4821", account: "BMW Group", customer: "Lena Fischer", channel: "Slack Connect", paged: true, incidentId: "PD-1",
    subject: "Reviews stopped posting on PRs", deadline: now + 132000,
    summary: "CodeRabbit stopped posting reviews on all PRs in their primary monorepo about an hour ago, with no config changes on their side; other repos still work. Ask whether the GitHub App install still shows active for that repo." },
  { id: "ISS-4817", account: "Ramp", customer: "Marcus Hu", channel: "Slack Connect", paged: false,
    subject: "Rate-limit errors on self-hosted runner", deadline: now + 408000,
    summary: "Their self-hosted runner is returning rate-limit errors since this morning's deploy; reviews queue but never complete on larger services. Confirm the runner's concurrency setting and recent version bump." },
  { id: "ISS-4810", account: "Brex", customer: "Priya Nair", channel: "Email", paged: false,
    subject: "Reviews missing on large monorepo PRs", deadline: now + 545000,
    summary: "Reviews silently skip on PRs touching 500+ files while smaller PRs in the same repo work, starting after they enabled path filters. Check whether the path filters exclude the changed directories." },
];

async function get(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}
async function post(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

export const api = {
  async googleAuth(credential) {
    if (MOCK) return { user: MOCK_USERS[0], email: MOCK_USERS[0].email, name: MOCK_USERS[0].name };
    return post("/api/auth", { credential });
  },
  async queue() {
    if (MOCK) return MOCK_TICKETS;
    return (await get("/api/queue")).tickets;
  },
  async summarize(issueId, fallback) {
    if (MOCK) return fallback;
    return (await post("/api/summarize", { issueId })).summary;
  },
  async respond({ issueId, body, userId, incidentId }) {
    if (MOCK) return { ok: true };
    return post("/api/respond", { issueId, body, userId, incidentId });
  },
};
