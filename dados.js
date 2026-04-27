const https = require("https");

// ── Neon PostgreSQL via REST (sem driver, puro HTTPS) ──
// DATABASE_URL = postgres://user:pass@host/db
function parseDbUrl(url) {
  const m = url.match(/postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^/]+)\/(.+)/);
  if (!m) throw new Error("DATABASE_URL inválida");
  return { user: m[1], password: m[2], host: m[3], db: m[4].split('?')[0] };
}

function neonQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!dbUrl) { reject(new Error("DATABASE_URL não configurada")); return; }

    // Use Neon HTTP API
    const neonHost = parseDbUrl(dbUrl).host;
    const body = JSON.stringify({ query: sql, params });

    const options = {
      hostname: neonHost,
      path: "/sql",
      method: "POST",
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
        "Neon-Connection-String": dbUrl,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const r = JSON.parse(data);
          if (r.message && !r.rows) reject(new Error(r.message));
          else resolve(r);
        } catch(e) { reject(new Error("Neon response parse error: " + data.slice(0,100))); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Neon timeout")); });
    req.write(body);
    req.end();
  });
}

// ── Fallback: use pg via require if available ──
async function query(sql, params = []) {
  // Try Neon HTTP first
  try {
    const r = await neonQuery(sql, params);
    return r;
  } catch(e) {
    // Fallback: try @neondatabase/serverless or pg
    try {
      let Client;
      try { Client = require("@neondatabase/serverless").Client; }
      catch(e2) { Client = require("pg").Client; }

      const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
      const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
      await client.connect();
      const result = await client.query(sql, params);
      await client.end();
      return { rows: result.rows };
    } catch(e2) {
      throw new Error(`DB error: ${e.message} | ${e2.message}`);
    }
  }
}

// ── Init tables ──
async function initTables() {
  const sqls = [
    `CREATE TABLE IF NOT EXISTS rise_store (
      id SERIAL PRIMARY KEY,
      user_key VARCHAR(100) NOT NULL DEFAULT 'default',
      store_key VARCHAR(100) NOT NULL,
      data JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_key, store_key)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_rise_store_key ON rise_store(user_key, store_key)`,
  ];
  for (const sql of sqls) {
    try { await query(sql); } catch(e) { console.warn("init:", e.message); }
  }
}

async function getStore(userKey, storeKey) {
  try {
    const r = await query(
      "SELECT data FROM rise_store WHERE user_key=$1 AND store_key=$2",
      [userKey, storeKey]
    );
    return r.rows?.[0]?.data || null;
  } catch(e) { return null; }
}

async function setStore(userKey, storeKey, data) {
  await query(
    `INSERT INTO rise_store (user_key, store_key, data, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_key, store_key)
     DO UPDATE SET data = $3, updated_at = NOW()`,
    [userKey, storeKey, JSON.stringify(data)]
  );
}

async function delStore(userKey, storeKey) {
  await query(
    "DELETE FROM rise_store WHERE user_key=$1 AND store_key=$2",
    [userKey, storeKey]
  );
}

// ── Handler ──
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-key, x-store-key");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  // Init tables on first call (idempotent)
  try { await initTables(); } catch(e) { console.warn("initTables:", e.message); }

  const userKey  = req.headers["x-user-key"]  || "default";
  const storeKey = req.headers["x-store-key"] || req.query?.key || "wa";

  if (req.method === "GET") {
    const data = await getStore(userKey, storeKey);

    // Return sensible defaults per store type
    if (!data) {
      const defaults = {
        wa:        { contacts:[], listas:[], logs:[], crm:[], fila:[], agendamentos:[], savedmsg:"", config:{} },
        crm:       { buscador:[], zap:[], empresa:[], cols:[], empresaName:"Minha Empresa" },
        historico: { buscas:[] },
        config:    {},
      };
      res.status(200).json(defaults[storeKey] || {});
      return;
    }
    res.status(200).json(data);
    return;
  }

  if (req.method === "POST") {
    // Parse body
    let body = req.body;
    if (!body || typeof body !== "object") {
      let raw = "";
      await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
      try { body = JSON.parse(raw); } catch(e) { res.status(400).json({ error: "Body inválido" }); return; }
    }
    try {
      await setStore(userKey, storeKey, body);
      res.status(200).json({ ok: true });
    } catch(e) {
      console.error("setStore error:", e.message);
      res.status(500).json({ error: e.message });
    }
    return;
  }

  if (req.method === "DELETE") {
    try {
      await delStore(userKey, storeKey);
      res.status(200).json({ ok: true });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
};
