import { listUsers } from "./_pylon.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId required" });

  try {
    const users = await listUsers();
    const valid = users.some((u) => u.id === userId);
    res.status(200).json({ valid });
  } catch (e) {
    res.status(502).json({ error: "Couldn't validate user", detail: e.message });
  }
}
