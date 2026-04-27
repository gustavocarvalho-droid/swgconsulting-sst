const https = require("https");

function callAnthropic(query, qtd, filtro, ordem, existingCnpjs, tentativa = 1) {
  return new Promise((resolve, reject) => {

    const exclusao = existingCnpjs.length > 0
      ? ` Ignore estes CNPJs já encontrados: ${existingCnpjs.slice(0, 15).join(', ')}.`
      : '';

    const filtroStr = filtro === "ativa" ? "somente Ativa"
      : filtro === "mei" ? "somente MEI"
      : filtro === "epp" ? "somente ME/EPP"
      : "qualquer situação";

    // Prompt enxuto para economizar tokens
    const systemPrompt = `Agente de busca de CNPJs de empresas brasileiras. Retorne APENAS JSON puro sem nenhum texto antes ou depois.

Busque ${qtd} empresas com CNPJ confirmado via web search (casadosdados.com.br, cnpj.biz, jusbrasil.com.br).
Filtro: ${filtroStr}.${exclusao}
Inclua APENAS empresas cujo CNPJ foi verificado. Se não encontrar o CNPJ, descarte.

EXCLUIR OBRIGATORIAMENTE (não inclua nenhuma dessas):
- Órgãos públicos, prefeituras, secretarias, autarquias, fundações públicas, câmaras municipais
- Hospitais, UBSs, postos de saúde, clínicas públicas, INAMPS, SUS
- Times, clubes e associações de futebol ou esporte
- Bancos, caixas econômicas, cooperativas de crédito, financeiras públicas (Bradesco, Itaú, CEF, BB, Santander etc.)
- Igrejas, templos, entidades religiosas
- Partidos políticos, sindicatos, entidades governamentais

Busque APENAS empresas privadas do setor produtivo/comercial/serviços.

JSON de resposta (sem markdown, sem texto extra, só o JSON):
{"query":"string","total":N,"empresas":[{"nome":"string","nome_fantasia":"string|null","cnpj":"XX.XXX.XXX/XXXX-XX","situacao":"Ativa|null","porte":"MEI|ME|EPP|Grande|null","municipio":"string|null","atividade":"string|null","email":"string|null","site":"string|null","telefone":"string|null","fonte_cnpj":"string","obs":"string|null"}]}`;

    const requestBody = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 3000,
      system: systemPrompt,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: `Busque ${qtd} empresas com CNPJ para: ${query}` }],
    });

    const contentLength = Buffer.byteLength(requestBody, "utf8");
    console.log(`[tentativa ${tentativa}] request ${contentLength} bytes`);

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      timeout: 120000,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
        "Content-Length": contentLength,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      console.log("[HTTP]", res.statusCode);
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);

          if (parsed?.error?.type === "rate_limit_error") {
            const espera = tentativa <= 3 ? 65000 : 0;
            if (espera) {
              console.log(`[RATE LIMIT] Tentativa ${tentativa}/3 — aguardando ${espera/1000}s...`);
              setTimeout(() => {
                callAnthropic(query, qtd, filtro, ordem, existingCnpjs, tentativa + 1)
                  .then(resolve).catch(reject);
              }, espera);
            } else {
              reject(new Error("Rate limit: tente novamente em 1 minuto"));
            }
            return;
          }

          resolve(parsed);
        } catch (e) {
          reject(new Error("JSON inválido: " + data.substring(0, 150)));
        }
      });
    });

    req.on("error", (e) => { console.error("[rede]", e.message); reject(e); });
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(requestBody);
    req.end();
  });
}

function extrairJSON(raw) {
  if (!raw) return null;
  // Remove qualquer texto antes do primeiro {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  const jsonStr = raw.substring(start, end + 1);
  try { return JSON.parse(jsonStr); } catch { return null; }
}


// ── Vercel serverless handler ──
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  if (req.method === "GET") {
    const key = process.env.ANTHROPIC_API_KEY;
    res.status(200).json({ status: "ok", key: key ? "configurada" : "FALTANDO" });
    return;
  }

  if (req.method !== "POST") { res.status(405).end(); return; }

  // Ler body — Vercel não faz parse automático
  let body = "";
  await new Promise((resolve) => {
    req.on("data", chunk => body += chunk);
    req.on("end", resolve);
  });

  let payload = {};
  try { payload = JSON.parse(body); } catch(e) {
    res.status(400).json({ error: "Body inválido" });
    return;
  }

  const { query, qtd, filtro, ordem } = payload;
  const existingCnpjs = Array.isArray(payload.existingCnpjs) ? payload.existingCnpjs : [];

  if (!query) {
    res.status(400).json({ error: "Campo query obrigatório" });
    return;
  }

  // Usar a API KEY da Vercel
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    res.status(200).json({ query, total: 0, empresas: [], obs: "ANTHROPIC_API_KEY não configurada" });
    return;
  }

  try {
    const apiResponse = await callAnthropic(
      query, qtd || 5, filtro || "todos", ordem || "relevancia", existingCnpjs
    );

    if (apiResponse.type === "error" || apiResponse.error) {
      const msg = apiResponse.error?.message || "Erro desconhecido";
      res.status(200).json({ query, total: 0, empresas: [], obs: msg });
      return;
    }

    const textBlock = apiResponse.content?.find(b => b.type === "text");
    const raw = textBlock?.text || "";
    const result = extrairJSON(raw) || { query, total: 0, empresas: [] };

    if (Array.isArray(result.empresas)) {
      const existingSet = new Set(existingCnpjs.map(c => c.replace(/\D/g, "")));
      const excluir = [
        /prefeitura/i, /secretaria/i, /câmara/i, /camara/i, /autarquia/i,
        /fundação/i, /fundacao/i, /governo/i, /municipal/i, /estadual/i,
        /federal/i, /ministério/i, /ministerio/i, /policia/i, /polícia/i,
        /hospital/i, /ubs\b/i, /posto de saude/i, /sus\b/i, /inamps/i,
        /futebol clube/i, /esporte clube/i, /atletico/i, /\bflamengo\b/i,
        /\bcorinthians\b/i, /\bpalmeiras\b/i, /\bsantos fc\b/i,
        /banco\b/i, /\bcaixa economica\b/i, /bradesco/i, /itaú/i, /itau/i,
        /santander/i, /\bnubank\b/i, /\bbtg\b/i, /\bbndes\b/i,
        /cooperativa de credito/i, /\bigreja\b/i, /\btemplo\b/i,
        /paróquia/i, /paroquia/i, /partido\b/i, /sindicato/i,
      ];
      result.empresas = result.empresas.filter(e => {
        if (!e.cnpj || e.cnpj === "null") return false;
        const digits = e.cnpj.replace(/\D/g, "");
        if (digits.length < 14) return false;
        if (existingSet.has(digits)) return false;
        const nome = (e.nome || "") + " " + (e.nome_fantasia || "") + " " + (e.atividade || "");
        if (excluir.some(rx => rx.test(nome))) return false;
        existingSet.add(digits);
        return true;
      });
      result.total = result.empresas.length;
    }

    res.status(200).json(result);

  } catch (e) {
    res.status(200).json({ query, total: 0, empresas: [], obs: e.message });
  }
};
