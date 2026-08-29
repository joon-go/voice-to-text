import { listUsers } from "./_pylon.js";

const PD_ROUTING_KEY = process.env.PAGERDUTY_ROUTING_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { issueId, userId } = req.body || {};
  if (!issueId || !userId) return res.status(400).json({ error: "issueId and userId required" });

  try {
    const users = await listUsers();
    if (!users.some((u) => u.id === userId)) return res.status(403).json({ error: "Invalid user identity" });
  } catch {
    return res.status(502).json({ error: "Couldn't validate user identity" });
  }
  if (!PD_ROUTING_KEY) return res.status(500).json({ error: "PAGERDUTY_ROUTING_KEY not configured" });

  try {
    const r = await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routing_key: PD_ROUTING_KEY,
        event_action: "resolve",
        dedup_key: `pylon-${issueId}`,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || JSON.stringify(data));
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: `PagerDuty resolve failed: ${err.message}` });
  }
}
