import { listUsers } from "./_pylon.js";

// Returns the roster so the signed-in engineer maps to a Pylon user_id.
// PRODUCTION: put real SSO (e.g. Vercel/Cloudflare Access) in front of the app
// and derive the engineer's identity from the verified session instead of a pick-list,
// so a response can't be attributed to someone who didn't write it.
export default async function handler(req, res) {
  try {
    res.status(200).json({ users: await listUsers() });
  } catch (err) {
    res.status(502).json({ error: "Couldn't load users.", detail: String(err.message || err) });
  }
}
