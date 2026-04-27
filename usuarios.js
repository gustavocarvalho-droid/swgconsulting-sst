const https = require("https");

// ── Neon HTTP query (same pattern as dados.js) ──
function parseDbUrl(url) {
  const m = url.match(/postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^/]+)\/(.+)/);
  if (!m) throw new Error("DATABASE_URL inválida");
  return { host: m[3], db: m[4].split("?")[0] };
}

function neonQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!dbUrl) { reject(new Error("DATABASE_URL não configurada")); return; }
    const neonHost = parseDbUrl(dbUrl).host;
    const body = JSON.stringify({ query: sql, params });
    const options = {
      hostname: neonHost,
      path: "/sql",
      method: "POST",
      timeout: 20000,
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
        } catch(e) { reject(new Error("Neon parse error: " + data.slice(0,100))); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Neon timeout")); });
    req.write(body);
    req.end();
  });
}

async function query(sql, params = []) {
  try {
    return await neonQuery(sql, params);
  } catch(e) {
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
      throw new Error(`DB: ${e.message} | ${e2.message}`);
    }
  }
}

async function initTables() {
  const sqls = [
    `CREATE TABLE IF NOT EXISTS rise_users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(200) NOT NULL,
      nome VARCHAR(200) NOT NULL,
      email VARCHAR(200),
      empresa VARCHAR(200),
      logo_url TEXT,
      is_master BOOLEAN DEFAULT FALSE,
      ativo BOOLEAN DEFAULT TRUE,
      plano VARCHAR(50) DEFAULT 'starter',
      acesso_buscador BOOLEAN DEFAULT TRUE,
      acesso_whatsapp BOOLEAN DEFAULT TRUE,
      acesso_crm BOOLEAN DEFAULT TRUE,
      acesso_ia BOOLEAN DEFAULT TRUE,
      limite_busca INTEGER DEFAULT 25,
      limite_disparo INTEGER DEFAULT 200,
      busca_usada INTEGER DEFAULT 0,
      disparo_usado INTEGER DEFAULT 0,
      busca_reset_at TIMESTAMPTZ DEFAULT NOW(),
      disparo_reset_at TIMESTAMPTZ DEFAULT NOW(),
      criado_em TIMESTAMPTZ DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ DEFAULT NOW(),
      criado_por VARCHAR(100),
      obs TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS rise_user_activity (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) NOT NULL,
      tipo VARCHAR(50) NOT NULL,
      descricao TEXT,
      dados TEXT,
      criado_em TIMESTAMPTZ DEFAULT NOW()
    )`,
    `INSERT INTO rise_users (username, password, nome, email, is_master, plano,
      limite_busca, limite_disparo)
     VALUES ('gustavo1996c', '1996', 'Gustavo', 'gustavo.carvalho@swgconsulting.com.br',
       TRUE, 'master', 999999, 999999)
     ON CONFLICT (username) DO UPDATE SET is_master=TRUE, limite_busca=999999, limite_disparo=999999`,
  ];
  for (const sql of sqls) {
    try { await query(sql); } catch(e) { console.warn("init:", e.message); }
  }
}

async function checkAndAlertLow(username) {
  try {
    const r = await query(
      `SELECT nome, empresa, (limite_busca-busca_usada) AS rb, (limite_disparo-disparo_usado) AS rd
       FROM rise_users WHERE username=$1`, [username]
    );
    if (!r.rows || !r.rows.length) return;
    const u = r.rows[0];
    const alerts = [];
    if (u.rb <= 5 && u.rb >= 0) alerts.push(`💎 Buscas: ${u.rb} restantes`);
    if (u.rd <= 5 && u.rd >= 0) alerts.push(`📱 Disparos: ${u.rd} restantes`);
    if (alerts.length) {
      await query(
        `INSERT INTO rise_user_activity (username, tipo, descricao, dados)
         VALUES ('MASTER', 'alerta_credito', $1, $2)`,
        [`${u.empresa||u.nome} com créditos baixos`, JSON.stringify({ username, alerts })]
      );
    }
  } catch(e) { console.warn("checkLow:", e.message); }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST" }); return; }

  try { await initTables(); } catch(e) { console.warn("initTables:", e.message); }

  let body = req.body;
  if (!body || typeof body !== "object") {
    let raw = "";
    await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
    try { body = JSON.parse(raw); } catch(e) { res.status(400).json({ error: "Body inválido" }); return; }
  }

  const { action } = body;

  try {
    // ── LIST ──
    if (action === "list") {
      const r = await query(
        `SELECT id,username,nome,email,empresa,logo_url,is_master,ativo,plano,
          acesso_buscador,acesso_whatsapp,acesso_crm,acesso_ia,
          limite_busca,limite_disparo,busca_usada,disparo_usado,
          criado_em,criado_por,obs
         FROM rise_users ORDER BY is_master DESC, criado_em ASC`
      );
      return res.status(200).json({ users: r.rows || [] });
    }

    // ── GET ──
    if (action === "get") {
      const r = await query("SELECT * FROM rise_users WHERE username=$1", [body.username]);
      if (!r.rows || !r.rows.length) return res.status(404).json({ error: "Não encontrado" });
      return res.status(200).json({ user: r.rows[0] });
    }

    // ── LOGIN ──
    if (action === "login") {
      const r = await query(
        "SELECT * FROM rise_users WHERE username=$1 AND password=$2 AND ativo=TRUE",
        [body.username, body.password]
      );
      if (!r.rows || !r.rows.length) return res.status(401).json({ error: "Usuário ou senha incorretos" });
      try {
        await query(
          "INSERT INTO rise_user_activity (username,tipo,descricao) VALUES ($1,'login','Login')",
          [body.username]
        );
      } catch(e) {}
      return res.status(200).json({ ok: true, user: r.rows[0] });
    }

    // ── CREATE ──
    if (action === "create") {
      const { username, password, nome, email, empresa, logo_url, plano,
              acesso_buscador, acesso_whatsapp, acesso_crm, acesso_ia,
              limite_busca, limite_disparo, obs, criado_por } = body;
      if (!username || !password || !nome) return res.status(400).json({ error: "username, password e nome obrigatórios" });
      try {
        await query(
          `INSERT INTO rise_users
            (username,password,nome,email,empresa,logo_url,plano,
             acesso_buscador,acesso_whatsapp,acesso_crm,acesso_ia,
             limite_busca,limite_disparo,obs,criado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [username, password, nome, email||null, empresa||null, logo_url||null,
           plano||"starter",
           acesso_buscador!==false, acesso_whatsapp!==false,
           acesso_crm!==false, acesso_ia!==false,
           limite_busca||25, limite_disparo||200, obs||null, criado_por||"master"]
        );
        try {
          await query(
            "INSERT INTO rise_user_activity (username,tipo,descricao,dados) VALUES ('MASTER','criar_usuario',$1,$2)",
            [`Criou ${username}`, JSON.stringify({ username, empresa })]
          );
        } catch(e) {}
        return res.status(200).json({ ok: true });
      } catch(e) {
        if (e.message.includes("unique") || e.message.includes("duplicate") || e.message.includes("23505"))
          return res.status(409).json({ error: "Usuário já existe" });
        return res.status(500).json({ error: e.message });
      }
    }

    // ── UPDATE ──
    if (action === "update") {
      const { username } = body;
      if (!username) return res.status(400).json({ error: "username obrigatório" });
      const allowed = ["nome","email","empresa","logo_url","plano","ativo",
        "acesso_buscador","acesso_whatsapp","acesso_crm","acesso_ia",
        "limite_busca","limite_disparo","obs","password"];
      const sets = [], vals = [];
      allowed.forEach(f => {
        if (body[f] !== undefined) { sets.push(`${f}=$${vals.length+1}`); vals.push(body[f]); }
      });
      if (!sets.length) return res.status(400).json({ error: "Nada para atualizar" });
      sets.push(`atualizado_em=NOW()`);
      vals.push(username);
      await query(`UPDATE rise_users SET ${sets.join(",")} WHERE username=$${vals.length}`, vals);
      return res.status(200).json({ ok: true });
    }

    // ── ADD CREDIT ──
    if (action === "addCredit") {
      const col = body.tipo === "disparo" ? "disparo_usado" : "busca_usada";
      await query(
        `UPDATE rise_users SET ${col}=GREATEST(0,${col}-$1),atualizado_em=NOW() WHERE username=$2`,
        [body.amount||25, body.username]
      );
      try {
        await query(
          "INSERT INTO rise_user_activity (username,tipo,descricao,dados) VALUES ('MASTER','add_credit',$1,$2)",
          [`+${body.amount} ${body.tipo} para ${body.username}`, JSON.stringify(body)]
        );
      } catch(e) {}
      return res.status(200).json({ ok: true });
    }

    // ── CONSUME CREDIT ──
    if (action === "consumeCredit") {
      const col = body.tipo === "disparo" ? "disparo_usado" : "busca_usada";
      const lim = body.tipo === "disparo" ? "limite_disparo" : "limite_busca";
      const r = await query(`SELECT ${lim},${col},is_master FROM rise_users WHERE username=$1`, [body.username]);
      if (!r.rows || !r.rows.length) return res.status(404).json({ error: "Não encontrado" });
      const u = r.rows[0];
      if (!u.is_master && u[col] >= u[lim]) return res.status(402).json({ error: "Créditos esgotados", remaining: 0 });
      await query(`UPDATE rise_users SET ${col}=${col}+$1 WHERE username=$2`, [body.amount||1, body.username]);
      try { await checkAndAlertLow(body.username); } catch(e) {}
      return res.status(200).json({ ok: true, remaining: Math.max(0, u[lim] - u[col] - (body.amount||1)) });
    }

    // ── ACTIVITY ──
    if (action === "activity") {
      let sql = "SELECT id,username,tipo,descricao,criado_em FROM rise_user_activity";
      const vals = [];
      if (body.username && body.username !== "ALL") {
        sql += " WHERE username=$1"; vals.push(body.username);
      }
      sql += ` ORDER BY criado_em DESC LIMIT ${body.limit||100}`;
      const r = await query(sql, vals);
      return res.status(200).json({ activity: r.rows || [] });
    }

    // ── ALERTS ──
    if (action === "alerts") {
      const r = await query(
        `SELECT id,descricao,dados,criado_em FROM rise_user_activity
         WHERE username='MASTER' AND tipo='alerta_credito'
         ORDER BY criado_em DESC LIMIT 20`
      );
      return res.status(200).json({ alerts: r.rows || [] });
    }

    return res.status(400).json({ error: "Ação desconhecida: " + action });

  } catch(e) {
    console.error("usuarios error:", e.message);
    return res.status(500).json({ error: e.message });
  }
};
