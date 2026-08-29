const PD_ROUTING_KEY = process.env.PAGERDUTY_ROUTING_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { issueId } = req.body || {};
  if (!issueId) return res.status(400).json({ error: "issueId required" });
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
