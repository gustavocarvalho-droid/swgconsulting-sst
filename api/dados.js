const https = require("https");

function parseDbUrl(url) {
  const m = url.match(/postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^/]+)\//);
  if (!m) throw new Error("DATABASE_URL inválida");
  return { host: m[3] };
}

function neonQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!dbUrl) { reject(new Error("DATABASE_URL não configurada")); return; }
    const { host } = parseDbUrl(dbUrl);
    const body = JSON.stringify({ query: sql, params });
    const options = {
      hostname: host, path: "/sql", method: "POST", timeout: 15000,
      headers: {
        "Content-Type": "application/json",
        "Neon-Connection-String": dbUrl,
        "Content-Length": Buffer.byteLength(body),
      }
    };
    const req = https.request(options, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const r = JSON.parse(data);
          if (r.message && !r.rows) reject(new Error(r.message));
          else resolve(r);
        } catch(e) { reject(new Error("Neon error: " + data.slice(0,100))); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Neon timeout")); });
    req.write(body); req.end();
  });
}

async function query(sql, params = []) {
  try { return await neonQuery(sql, params); }
  catch(e) {
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
    } catch(e2) { throw new Error(`DB: ${e.message} | ${e2.message}`); }
  }
}

async function initTables() {
  const sqls = [
    `CREATE TABLE IF NOT EXISTS rise_store (
      user_key VARCHAR(100) NOT NULL, store_key VARCHAR(100) NOT NULL,
      data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_key, store_key))`,
    `CREATE INDEX IF NOT EXISTS idx_rise_store_key ON rise_store(user_key, store_key)`,
    `CREATE TABLE IF NOT EXISTS swg_crm (
      id VARCHAR(100) PRIMARY KEY, tab VARCHAR(50) DEFAULT 'buscador',
      empresa TEXT, nome TEXT, cnpj TEXT, tel TEXT, email TEXT,
      cidade TEXT, segmento TEXT, site TEXT, status VARCHAR(50) DEFAULT 'novo',
      prioridade VARCHAR(20) DEFAULT 'baixa', responsavel TEXT,
      valor NUMERIC DEFAULT 0, obs TEXT, prox_acao TEXT,
      servicos JSONB DEFAULT '[]', historico JSONB DEFAULT '[]',
      criado_em BIGINT, atualizado_em BIGINT, source TEXT)`,
    `CREATE TABLE IF NOT EXISTS swg_wa_contacts (
      id VARCHAR(100) PRIMARY KEY, nome TEXT, tel TEXT, empresa TEXT,
      cidade TEXT, status VARCHAR(50) DEFAULT 'pendente', responsavel TEXT,
      criado_em BIGINT)`,
  ];
  for (const sql of sqls) {
    try { await query(sql); } catch(e) { console.warn("init:", e.message); }
  }
}

async function getStore(userKey, storeKey) {
  try {
    const r = await query("SELECT data FROM rise_store WHERE user_key=$1 AND store_key=$2", [userKey, storeKey]);
    return r.rows?.[0]?.data || null;
  } catch(e) { return null; }
}

async function setStore(userKey, storeKey, data) {
  await query(
    `INSERT INTO rise_store (user_key, store_key, data, updated_at) VALUES ($1,$2,$3,NOW())
     ON CONFLICT (user_key, store_key) DO UPDATE SET data=$3, updated_at=NOW()`,
    [userKey, storeKey, JSON.stringify(data)]
  );
}

async function getCRMFromDB() {
  try {
    const r = await query(
      `SELECT id, tab, empresa, nome, cnpj, tel, email, cidade, segmento, site,
              status, prioridade, responsavel, CAST(valor AS FLOAT) as valor,
              obs, prox_acao as "proxAcao", servicos, historico,
              criado_em as "criadoEm", atualizado_em as "atualizadoEm", source as "_source"
       FROM swg_crm ORDER BY criado_em DESC LIMIT 5000`
    );
    const rows = r.rows || [];
    return {
      buscador: rows.filter(l => !l.tab || l.tab === 'buscador'),
      zap:      rows.filter(l => l.tab === 'zap'),
      empresa:  rows.filter(l => l.tab === 'empresa'),
      cols: [], empresaName: 'SWG Consulting'
    };
  } catch(e) {
    console.warn("getCRMFromDB:", e.message);
    return { buscador:[], zap:[], empresa:[], cols:[], empresaName:'SWG Consulting' };
  }
}

async function getWAFromDB() {
  try {
    const r = await query(
      `SELECT id, nome, tel, empresa, cidade, status, responsavel,
              criado_em as "addedAt" FROM swg_wa_contacts ORDER BY criado_em DESC LIMIT 10000`
    );
    return r.rows || [];
  } catch(e) { return []; }
}

async function saveLeadToDB(lead) {
  await query(
    `INSERT INTO swg_crm (id, tab, empresa, nome, cnpj, tel, email, cidade, segmento, site,
      status, prioridade, responsavel, valor, obs, prox_acao, servicos, historico, criado_em, atualizado_em, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (id) DO UPDATE SET
       tab=$2, empresa=$3, nome=$4, cnpj=$5, tel=$6, email=$7, cidade=$8, segmento=$9,
       site=$10, status=$11, prioridade=$12, responsavel=$13, valor=$14, obs=$15,
       prox_acao=$16, servicos=$17, historico=$18, atualizado_em=$20`,
    [lead.id, lead.tab||'buscador', lead.empresa||'', lead.nome||'', lead.cnpj||'',
     lead.tel||'', lead.email||'', lead.cidade||'', lead.segmento||'', lead.site||'',
     lead.status||'novo', lead.prioridade||'baixa', lead.responsavel||'',
     parseFloat(lead.valor)||0, lead.obs||'', lead.proxAcao||'',
     JSON.stringify(lead.servicos||[]), JSON.stringify(lead.historico||[]),
     lead.criadoEm||Date.now(), lead.atualizadoEm||Date.now(), lead._source||'manual']
  );
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-key, x-store-key");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  try { await initTables(); } catch(e) { console.warn("initTables:", e.message); }

  const userKey  = req.headers["x-user-key"]  || "default";
  const storeKey = req.headers["x-store-key"] || req.query?.key || "wa";

  // ── GET ──
  if (req.method === "GET") {
    if (storeKey === "crm") {
      const data = await getCRMFromDB();
      res.status(200).json(data); return;
    }
    if (storeKey === "wa") {
      const stored = await getStore(userKey, "wa") ||
        { contacts:[], listas:[], logs:[], fila:[], agendamentos:[], savedmsg:"", config:{} };
      const dbContacts = await getWAFromDB();
      if (dbContacts.length > 0) stored.contacts = dbContacts;
      res.status(200).json(stored); return;
    }
    const data = await getStore(userKey, storeKey);
    res.status(200).json(data || { buscas:[] }); return;
  }

  // ── POST ──
  if (req.method === "POST") {
    let body = req.body;
    if (!body || typeof body !== "object") {
      let raw = "";
      await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
      try { body = JSON.parse(raw); } catch(e) { res.status(400).json({ error: "Body inválido" }); return; }
    }

    // Salvar CRM no banco
    if (storeKey === "crm" && (body.buscador !== undefined || body.zap !== undefined || body.empresa !== undefined)) {
      try {
        const all = [
          ...(body.buscador||[]).map(l=>({...l,tab:'buscador'})),
          ...(body.zap||[]).map(l=>({...l,tab:'zap'})),
          ...(body.empresa||[]).map(l=>({...l,tab:'empresa'})),
        ];
        for (const lead of all) await saveLeadToDB(lead);
        res.status(200).json({ ok: true }); return;
      } catch(e) { res.status(500).json({ error: e.message }); return; }
    }

    try {
      await setStore(userKey, storeKey, body);
      res.status(200).json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
    return;
  }

  // ── DELETE ──
  if (req.method === "DELETE") {
    try { await query("DELETE FROM rise_store WHERE user_key=$1 AND store_key=$2", [userKey, storeKey]); res.status(200).json({ ok: true }); }
    catch(e) { res.status(500).json({ error: e.message }); }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
};
