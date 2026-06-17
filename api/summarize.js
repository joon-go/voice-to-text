import { getIssueThread } from "./_pylon.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { issueId } = req.body || {};
  if (!issueId) return res.status(400).json({ error: "issueId required" });

  try {
    const { issue, messages } = await getIssueThread(issueId);
    const issueDetail = issue.data || issue;
    const issueBody = issueDetail.body_text || issueDetail.body_html || "";
    const parts = [];
    if (issueBody) parts.push(`Customer: ${issueBody}`);
    for (const m of messages) {
      const body = m.body_text || m.body_html || m.message_html || "";
      if (body) parts.push(`${m.from_customer ? "Customer" : "Agent"}: ${body}`);
    }
    const transcript = parts.join("\n");

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 160,
        system:
          "You brief a support engineer who has under 15 minutes to send a first response. " +
          "In at most two plain sentences, state the customer's core problem and the single most useful next step or clarifying question. No greeting, no preamble.",
        messages: [{ role: "user", content: `Ticket thread:\n\n${transcript}` }],
      }),
    });
    const data = await r.json();
    const summary = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    res.status(200).json({ summary: summary || "No summary available — read the thread." });
  } catch (err) {
    res.status(502).json({ error: "Couldn't summarize.", detail: String(err.message || err) });
  }
}
