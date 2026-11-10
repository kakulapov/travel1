// Vercel serverless function: sends an exported file (PDF/CSV) to the user's chat with the bot.
// Needs one environment variable in Vercel: BOT_TOKEN (the token @BotFather gave you).
// The token stays on the server. Never put it in index.html.

const crypto = require("crypto");

// Checks that the request really comes from Telegram for this bot, and returns the Telegram user.
function verifiedUser(initData, token) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const checkString = skip => [...params.entries()]
    .filter(([k]) => k !== "hash" && !skip.includes(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const matches = [[], ["signature"]].some(skip => {
    const expected = crypto.createHmac("sha256", secret).update(checkString(skip)).digest("hex");
    return expected.length === hash.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash));
  });
  if (!matches) return null;
  const age = Date.now() / 1000 - Number(params.get("auth_date"));
  if (!(age >= 0 && age < 24 * 3600)) return null; // reject anything older than a day
  try { return JSON.parse(params.get("user")); } catch (e) { return null; }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  const token = process.env.BOT_TOKEN;
  if (!token) return res.status(500).json({ ok: false, error: "BOT_TOKEN isn't set in Vercel yet" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const { initData, filename, caption, data } = body;

  const user = verifiedUser(String(initData || ""), token);
  if (!user || !user.id) return res.status(401).json({ ok: false, error: "couldn't confirm this came from Telegram. Close and reopen the app" });

  const name = String(filename || "export").replace(/[^\w.\-]/g, "_").slice(0, 80);
  const type = name.endsWith(".pdf") ? "application/pdf" : name.endsWith(".csv") ? "text/csv" : null;
  if (!type) return res.status(400).json({ ok: false, error: "only PDF and CSV files can be sent" });
  if (typeof data !== "string" || !data.length || data.length > 4000000) return res.status(400).json({ ok: false, error: "file is empty or too large" });

  const form = new FormData();
  form.append("chat_id", String(user.id));
  if (caption) form.append("caption", String(caption).slice(0, 200));
  form.append("document", new Blob([Buffer.from(data, "base64")], { type }), name);

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form });
    const out = await tgRes.json();
    if (!out.ok) {
      const msg = /chat not found|initiate|blocked/i.test(out.description || "")
        ? "the bot can't message you yet. Open the bot chat and tap Start, then try again"
        : out.description || "Telegram refused the file";
      return res.status(502).json({ ok: false, error: msg });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ ok: false, error: "couldn't reach Telegram" });
  }
};
