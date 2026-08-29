import { postFirstResponse, listUsers } from "./_pylon.js";

// Guard against an empty/templated post slipping through — the first response
// must be original content the engineer wrote (requirement: from the live person).
function looksOriginal(text) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  return words.length >= 3;
}

async function resolvePagerDuty(issueId) {
  const routingKey = process.env.PAGERDUTY_ROUTING_KEY;
  if (!routingKey || !issueId) return;
  await fetch("https://events.pagerduty.com/v2/enqueue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      routing_key: routingKey,
      event_action: "resolve",
      dedup_key: `pylon-${issueId}`,
    }),
  }).catch(() => {});
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { issueId, body, userId, incidentId } = req.body || {};

  if (!issueId || !userId) return res.status(400).json({ error: "issueId and userId required" });
  if (!looksOriginal(body)) return res.status(422).json({ error: "First response must be original text you wrote." });

  // Validate that userId corresponds to a real Pylon user before posting
  try {
    const users = await listUsers();
    const validUser = users.some((u) => u.id === userId);
    if (!validUser) {
      return res.status(403).json({ error: "Invalid user identity" });
    }
  } catch (err) {
    return res.status(502).json({ error: "Couldn't validate user identity" });
  }

  try {
    const message = await postFirstResponse({ issueId, body, userId });
    await resolvePagerDuty(issueId);
    res.status(200).json({ ok: true, messageId: message.id });
  } catch (err) {
    res.status(502).json({ error: `Couldn't post the response to Pylon: ${err.message || err}` });
  }
}
