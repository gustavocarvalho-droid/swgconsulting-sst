const https = require("https");

// ── RISE IA — Serverless proxy para Anthropic API ──
// Vercel function: POST /api/ia
// Body: { messages: [...], system?: string, max_tokens?: number }
// Headers: nenhum — a API key fica no servidor (segura)

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST")   { res.status(405).json({ error: "Method not allowed" }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada no servidor." });
    return;
  }

  // Parse body
  let body = req.body;
  if (!body || typeof body !== "object") {
    let raw = "";
    await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
    try { body = JSON.parse(raw); } catch(e) {
      res.status(400).json({ error: "Body JSON inválido" }); return;
    }
  }

  const { messages, system, max_tokens, model } = body;
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: "Campo 'messages' obrigatório" }); return;
  }

  // Build Anthropic request
  const payload = JSON.stringify({
    model:      model || "claude-sonnet-4-20250514",
    max_tokens: max_tokens || 1200,
    system:     system || "Você é a RISE IA, especialista em SST e negócios.",
    messages:   messages.slice(-14), // keep last 14 messages for context
  });

  return new Promise((resolve) => {
    const options = {
      hostname: "api.anthropic.com",
      path:     "/v1/messages",
      method:   "POST",
      timeout:  55000,
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length":    Buffer.byteLength(payload, "utf8"),
      },
    };

    const apiReq = https.request(options, (apiRes) => {
      let data = "";
      apiRes.on("data", chunk => data += chunk);
      apiRes.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          // Return full response or just the text
          if (parsed.content && parsed.content[0]) {
            res.status(200).json({
              ok:      true,
              text:    parsed.content[0].text || "",
              usage:   parsed.usage || {},
              model:   parsed.model || "",
            });
          } else if (parsed.error) {
            res.status(400).json({ error: parsed.error.message || "Erro Anthropic" });
          } else {
            res.status(200).json(parsed);
          }
        } catch(e) {
          res.status(500).json({ error: "Parse error: " + e.message });
        }
        resolve();
      });
    });

    apiReq.on("error", (e) => {
      res.status(500).json({ error: "Network error: " + e.message });
      resolve();
    });
    apiReq.on("timeout", () => {
      apiReq.destroy();
      res.status(504).json({ error: "Timeout na API Anthropic (55s)" });
      resolve();
    });

    apiReq.write(payload);
    apiReq.end();
  });
};
