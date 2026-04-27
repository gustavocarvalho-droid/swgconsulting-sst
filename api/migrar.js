// ── SWG Consulting SST — API de Migração ──
// POST /api/migrar  { action: 'import_maps' | 'import_wa' | 'status' }

const https = require('https');

function parseDbUrl(url) {
  const m = url.match(/postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^/]+)\//);
  if (!m) throw new Error('DATABASE_URL inválida');
  return { host: m[3] };
}

function neonQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!dbUrl) { reject(new Error('DATABASE_URL não configurada')); return; }
    const { host } = parseDbUrl(dbUrl);
    const body = JSON.stringify({ query: sql, params });
    const options = {
      hostname: host, path: '/sql', method: 'POST', timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Neon-Connection-String': dbUrl,
        'Content-Length': Buffer.byteLength(body),
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(data.slice(0,200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Neon timeout')); });
    req.write(body); req.end();
  });
}

async function initTables() {
  await neonQuery(`CREATE TABLE IF NOT EXISTS swg_crm (
    id VARCHAR(100) PRIMARY KEY,
    tab VARCHAR(50) DEFAULT 'buscador',
    empresa TEXT, nome TEXT, cnpj TEXT, tel TEXT, email TEXT,
    cidade TEXT, segmento TEXT, site TEXT, status VARCHAR(50) DEFAULT 'novo',
    prioridade VARCHAR(20) DEFAULT 'baixa', responsavel TEXT,
    valor NUMERIC DEFAULT 0, obs TEXT, prox_acao TEXT,
    servicos JSONB DEFAULT '[]', historico JSONB DEFAULT '[]',
    criado_em BIGINT, atualizado_em BIGINT, source TEXT,
    dados_extras JSONB DEFAULT '{}'
  )`);
  await neonQuery(`CREATE TABLE IF NOT EXISTS swg_wa_contacts (
    id VARCHAR(100) PRIMARY KEY,
    nome TEXT, tel TEXT, empresa TEXT, cidade TEXT,
    status VARCHAR(50) DEFAULT 'pendente', responsavel TEXT,
    lista_ids JSONB DEFAULT '[]', dados_extras JSONB DEFAULT '{}',
    criado_em BIGINT
  )`);
  await neonQuery(`CREATE TABLE IF NOT EXISTS swg_migracoes (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(100), total INT, status VARCHAR(50),
    criado_em TIMESTAMP DEFAULT NOW()
  )`);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try { await initTables(); } catch(e) { console.warn('initTables:', e.message); }

  let body = req.body;
  if (!body || typeof body !== 'object') {
    let raw = '';
    await new Promise(r => { req.on('data', c => raw += c); req.on('end', r); });
    try { body = JSON.parse(raw); } catch(e) { body = {}; }
  }

  const { action, data } = body;

  // ── STATUS ──
  if (req.method === 'GET' || action === 'status') {
    const crm = await neonQuery("SELECT COUNT(*) as n, tab FROM swg_crm GROUP BY tab");
    const wa  = await neonQuery("SELECT COUNT(*) as n FROM swg_wa_contacts");
    res.json({ ok: true, crm: crm.rows, wa: wa.rows?.[0]?.n || 0 });
    return;
  }

  // ── IMPORT CRM (Maps Leads ou Buscador) ──
  if (action === 'import_crm') {
    if (!Array.isArray(data)) { res.status(400).json({ error: 'data deve ser array' }); return; }
    let inserted = 0, skipped = 0;
    for (const lead of data) {
      try {
        await neonQuery(
          `INSERT INTO swg_crm (id, tab, empresa, nome, cnpj, tel, email, cidade, segmento, site,
            status, prioridade, responsavel, valor, obs, prox_acao, servicos, historico,
            criado_em, atualizado_em, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           ON CONFLICT (id) DO NOTHING`,
          [
            lead.id, lead.tab || 'buscador',
            lead.empresa || '', lead.nome || '', lead.cnpj || '',
            lead.tel || '', lead.email || '', lead.cidade || '',
            lead.segmento || '', lead.site || '',
            lead.status || 'novo', lead.prioridade || 'baixa',
            lead.responsavel || '', lead.valor || 0,
            lead.obs || '', lead.proxAcao || '',
            JSON.stringify(lead.servicos || []),
            JSON.stringify(lead.historico || []),
            lead.criadoEm || Date.now(), lead.atualizadoEm || Date.now(),
            lead._source || 'import'
          ]
        );
        inserted++;
      } catch(e) { skipped++; }
    }
    await neonQuery(
      "INSERT INTO swg_migracoes (tipo, total, status) VALUES ($1,$2,$3)",
      ['import_crm', inserted, 'done']
    );
    res.json({ ok: true, inserted, skipped, total: data.length });
    return;
  }

  // ── IMPORT WA CONTACTS from Neon Rise ──
  if (action === 'import_wa_from_rise') {
    const riseUrl = body.riseUrl || process.env.RISE_DATABASE_URL;
    if (!riseUrl) { res.status(400).json({ error: 'Informe a riseUrl no body ou configure RISE_DATABASE_URL' }); return; }
    // Query Rise Neon for wa contacts
    const { host } = parseDbUrl(riseUrl);
    const waBody = JSON.stringify({ query: "SELECT * FROM rise_store WHERE store_key='wa' LIMIT 1", params: [] });
    const waData = await new Promise((resolve, reject) => {
      const opts = {
        hostname: host, path: '/sql', method: 'POST', timeout: 20000,
        headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': riseUrl, 'Content-Length': Buffer.byteLength(waBody) }
      };
      const r = https.request(opts, res2 => {
        let d = ''; res2.on('data', c => d += c);
        res2.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
      });
      r.on('error', reject); r.write(waBody); r.end();
    });
    const waStore = waData.rows?.[0]?.data;
    const contacts = waStore?.contacts || [];
    let inserted = 0;
    for (const c of contacts) {
      try {
        await neonQuery(
          `INSERT INTO swg_wa_contacts (id, nome, tel, empresa, cidade, status, responsavel, criado_em)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
          [String(c.id), c.nome||'', c.tel||'', c.empresa||'', c.cidade||'',
           c.status||'pendente', c.responsavel||'', c.addedAt||Date.now()]
        );
        inserted++;
      } catch(e) {}
    }
    res.json({ ok: true, inserted, total: contacts.length });
    return;
  }

  res.status(400).json({ error: 'action inválida. Use: status, import_crm, import_wa_from_rise' });
};
