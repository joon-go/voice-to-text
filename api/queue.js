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
          source: m.source,
          body: m.body_text || m.body_html || m.message_html || "",
        })),
      });
    }
    const tickets = await listEliteAwaitingFirstResponse();
    res.status(200).json({ tickets });
  } catch (err) {
    res.status(502).json({ error: "Couldn't load the queue from Pylon.", detail: String(err.message || err) });
  }
}
