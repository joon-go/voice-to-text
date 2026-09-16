import { listUsers } from "./_pylon.js";

const PD_API_KEY = process.env.PAGERDUTY_API_KEY;
const PD_SERVICE_ID = process.env.PD_SERVICE_ID;
const PD_PRIORITY_P0 = process.env.PD_PRIORITY_P0;
const PD_ENG_POLICY = process.env.PD_ENG_ESCALATION_POLICY;

function pdHeaders(userEmail) {
  return {
    Authorization: `Token token=${PD_API_KEY}`,
    "Content-Type": "application/json",
    From: userEmail,
  };
}

async function pdGet(path) {
  const r = await fetch(`https://api.pagerduty.com${path}`, {
    headers: { Authorization: `Token token=${PD_API_KEY}`, "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`PagerDuty GET ${path} ${r.status}`);
  return r.json();
}

async function findIncidentByDedup(dedupKey) {
  const { incidents = [] } = await pdGet(
    `/incidents?service_ids[]=${PD_SERVICE_ID}&statuses[]=triggered&statuses[]=acknowledged&incident_key=${encodeURIComponent(dedupKey)}&limit=1`
  );
  return incidents[0] || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { issueId, userId, userEmail } = req.body || {};
  if (!issueId || !userId) return res.status(400).json({ error: "issueId and userId required" });
  if (!PD_API_KEY || !PD_SERVICE_ID || !PD_PRIORITY_P0 || !PD_ENG_POLICY) return res.status(500).json({ error: "PagerDuty configuration incomplete" });

  try {
    const users = await listUsers();
    if (!users.some((u) => u.id === userId)) return res.status(403).json({ error: "Invalid user identity" });
  } catch {
    return res.status(502).json({ error: "Couldn't validate user identity" });
  }

  const dedupKey = `pylon-${issueId}`;
  const fromEmail = userEmail || "support@coderabbit.ai";

  try {
    const incident = await findIncidentByDedup(dedupKey);
    if (!incident) return res.status(404).json({ error: "No active PagerDuty incident found for this issue" });

    const updateR = await fetch(`https://api.pagerduty.com/incidents/${incident.id}`, {
      method: "PUT",
      headers: pdHeaders(fromEmail),
      body: JSON.stringify({
        incident: {
          id: incident.id,
          type: "incident",
          priority: { id: PD_PRIORITY_P0, type: "priority_reference" },
          urgency: "high",
        },
      }),
    });
    if (!updateR.ok) {
      const err = await updateR.text();
      throw new Error(`Failed to update incident: ${updateR.status}`);
    }

    const responderR = await fetch(`https://api.pagerduty.com/incidents/${incident.id}/responder_requests`, {
      method: "POST",
      headers: pdHeaders(fromEmail),
      body: JSON.stringify({
        requester_id: incident.assignments?.[0]?.assignee?.id || undefined,
        message: "Engineering escalation — Major Incident promoted from First Response app",
        responder_request_targets: [
          {
            responder_request_target: {
              id: PD_ENG_POLICY,
              type: "escalation_policy_reference",
            },
          },
        ],
      }),
    });

    let respondersAdded = false;
    if (responderR.ok) {
      respondersAdded = true;
    } else {
      console.error("Failed to add responders:", responderR.status, await responderR.text());
    }

    res.status(200).json({ ok: true, incidentId: incident.id, respondersAdded });
  } catch (err) {
    console.error("Promote major failed:", err);
    res.status(502).json({ error: "Failed to promote to major incident" });
  }
}
