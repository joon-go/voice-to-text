import { postFirstResponse, listUsers } from "./_pylon.js";

// Guard against an empty/templated post slipping through — the first response
// must be original content the engineer wrote (requirement: from the live person).
function looksOriginal(text) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  return words.length >= 3;
}

async function ackPagerDuty(incidentId) {
  const token = process.env.PAGERDUTY_API_TOKEN;
  const from = process.env.PAGERDUTY_FROM_EMAIL;
  if (!token || !from || !incidentId) return;
  await fetch(`https://api.pagerduty.com/incidents/${incidentId}`, {
    method: "PUT",
    headers: {
      Authorization: `Token token=${token}`,
      From: from,
      "Content-Type": "application/json",
      Accept: "application/vnd.pagerduty+json;version=2",
    },
    body: JSON.stringify({ incident: { type: "incident_reference", status: "acknowledged" } }),
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
    await ackPagerDuty(incidentId);
    res.status(200).json({ ok: true, messageId: message.id });
  } catch (err) {
    res.status(502).json({ error: `Couldn't post the response to Pylon: ${err.message || err}` });
  }
}
