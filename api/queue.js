import { listEliteAwaitingFirstResponse, debugQueue, getIssueThread } from "./_pylon.js";

export default async function handler(req, res) {
  try {
    if (req.query.debug === "1") {
      const info = await debugQueue();
      return res.status(200).json(info);
    }
    if (req.query.thread) {
      const { issue, messages } = await getIssueThread(req.query.thread);
      const detail = issue.data || issue;
      return res.status(200).json({
        issueBody: detail.body_text || detail.body_html || "(empty)",
        messageCount: messages.length,
        messages: messages.map((m) => ({
          id: m.id,
          from_customer: m.from_customer,
          source: m.source,
          body_text: (m.body_text || "").slice(0, 200),
          body_html: (m.body_html || "").slice(0, 200),
        })),
      });
    }
    const tickets = await listEliteAwaitingFirstResponse();
    res.status(200).json({ tickets });
  } catch (err) {
    res.status(502).json({ error: "Couldn't load the queue from Pylon.", detail: String(err.message || err) });
  }
}
