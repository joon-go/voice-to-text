const PD_API_KEY = process.env.PAGERDUTY_API_KEY;

async function pdGet(path) {
  const r = await fetch(`https://api.pagerduty.com${path}`, {
    headers: { Authorization: `Token token=${PD_API_KEY}`, "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`PagerDuty ${path} ${r.status}: ${await r.text()}`);
  return r.json();
}

export default async function handler(req, res) {
  if (!PD_API_KEY) return res.status(500).json({ error: "PAGERDUTY_API_KEY not configured" });

  try {
    const [services, priorities, policies] = await Promise.all([
      pdGet("/services?limit=25"),
      pdGet("/priorities"),
      pdGet("/escalation_policies?limit=25"),
    ]);

    res.status(200).json({
      services: services.services.map((s) => ({ id: s.id, name: s.name, status: s.status })),
      priorities: priorities.priorities.map((p) => ({ id: p.id, name: p.name })),
      escalation_policies: policies.escalation_policies.map((e) => ({ id: e.id, name: e.name })),
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
