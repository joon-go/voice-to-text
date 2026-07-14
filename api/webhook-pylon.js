const APP_URL = process.env.APP_URL || "https://voice-to-text-sandy.vercel.app";
const PD_ROUTING_KEY = process.env.PAGERDUTY_ROUTING_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const event = req.body;
  const issue = event?.data || event?.issue || event;
  const issueId = issue?.id;
  const issueNumber = issue?.number;
  const title = issue?.title || issue?.subject || "(no subject)";
  const account = issue?.account?.name || issue?.account || "Unknown";

  if (!issueId) return res.status(400).json({ error: "No issue ID in payload" });
  if (!PD_ROUTING_KEY) return res.status(500).json({ error: "PAGERDUTY_ROUTING_KEY not configured" });

  const deeplink = `${APP_URL}?issue=${issueId}`;

  const pdPayload = {
    routing_key: PD_ROUTING_KEY,
    event_action: "trigger",
    dedup_key: `pylon-${issueId}`,
    payload: {
      summary: `[Intuit P0] ${account}: ${title}`,
      severity: "critical",
      source: "Pylon",
      component: "Intuit Support",
      custom_details: {
        issue_number: issueNumber,
        account,
        title,
        deeplink,
      },
    },
    links: [
      { href: deeplink, text: "Open First Response App" },
      { href: `https://app.usepylon.com/support/issues/views/all-issues?issueNumber=${issueNumber}&view=fs`, text: "View in Pylon" },
    ],
  };

  try {
    const r = await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pdPayload),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || JSON.stringify(data));
    res.status(200).json({ ok: true, dedup_key: data.dedup_key });
  } catch (err) {
    res.status(502).json({ error: `PagerDuty trigger failed: ${err.message}` });
  }
}
