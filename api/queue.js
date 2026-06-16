import { listEliteAwaitingFirstResponse } from "./_pylon.js";

export default async function handler(req, res) {
  try {
    const tickets = await listEliteAwaitingFirstResponse();
    res.status(200).json({ tickets });
  } catch (err) {
    res.status(502).json({ error: "Couldn't load the queue from Pylon.", detail: String(err.message || err) });
  }
}
