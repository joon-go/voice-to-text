import { listEliteAwaitingFirstResponse, debugQueue, getIssueThread } from "./_pylon.js";

export default async function handler(req, res) {
  try {
    if (req.query.debug === "1") {
      const info = await debugQueue();
      return res.status(200).json(info);
    }
    if (req.query.thread) {
      const { issue, messages, singleMsg } = await getIssueThread(req.query.thread);
      const detail = issue.data || issue;
      return res.status(200).json({
        issueBody: detail.body_text || detail.body_html || "(empty)",
        issueAllKeys: Object.keys(detail),
        messageCount: messages.length,
        singleMessageFetch: singleMsg || null,
        messages: messages.slice(0, 2).map((m) => {
          const out = {};
          for (const [k, v] of Object.entries(m)) {
            if (typeof v === "string") out[k] = v.slice(0, 300);
            else out[k] = v;
          }
          return out;
        }),
      });
    }
    const tickets = await listEliteAwaitingFirstResponse();
    res.status(200).json({ tickets });
  } catch (err) {
    res.status(502).json({ error: "Couldn't load the queue from Pylon.", detail: String(err.message || err) });
  }
}
