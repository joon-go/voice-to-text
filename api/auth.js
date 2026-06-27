import { listUsers } from "./_pylon.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: "credential required" });
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: "GOOGLE_CLIENT_ID not configured" });

  let payload;
  try {
    const resp = await fetch("https://oauth2.googleapis.com/tokeninfo", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `id_token=${encodeURIComponent(credential)}`,
    });
    if (!resp.ok) throw new Error("Invalid token");
    payload = await resp.json();
  } catch (e) {
    return res.status(401).json({ error: "Invalid Google token" });
  }

  if (payload.aud !== GOOGLE_CLIENT_ID) {
    return res.status(401).json({ error: "Token audience mismatch" });
  }

  const email = payload.email;
  if (!email || payload.email_verified !== "true") {
    return res.status(401).json({ error: "Email not verified" });
  }

  let users;
  try {
    users = await listUsers();
  } catch (e) {
    return res.status(502).json({ error: "Couldn't load Pylon users" });
  }

  const pylonUser = users.find((u) => u.email && u.email.toLowerCase() === email.toLowerCase());
  if (!pylonUser) {
    return res.status(403).json({ error: `${email} is not on the support team` });
  }

  res.status(200).json({
    user: pylonUser,
    email,
    name: payload.name || pylonUser.name,
    picture: payload.picture || null,
  });
}
