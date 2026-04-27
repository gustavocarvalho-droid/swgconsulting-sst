const https = require("https");

// ── Tabela CNAE × Grau de Risco (NR-4 Quadro I) ──
const CNAE_RISCO = {
  "01":3,"02":3,"03":3,"05":4,"06":4,"07":4,"08":3,"09":4,
  "10":3,"11":3,"12":4,"13":3,"14":3,"15":3,"16":3,"17":3,
  "18":2,"19":4,"20":4,"21":3,"22":3,"23":3,"24":4,"25":3,
  "26":2,"27":3,"28":3,"29":3,"30":3,"31":2,"32":2,"33":3,
  "35":4,"36":2,"37":3,"38":3,"39":3,
  "41":3,"42":3,"43":3,
  "45":2,"46":2,"47":2,
  "49":2,"50":3,"51":2,"52":3,"53":2,
  "55":2,"56":2,
  "58":1,"59":1,"60":1,"61":2,"62":1,"63":1,
  "64":1,"65":1,"66":1,"68":1,
  "69":1,"70":1,"71":1,"72":1,"73":1,"74":1,"75":1,
  "77":2,"78":1,"79":1,"80":3,"81":2,"82":1,"84":1,"85":1,
  "86":2,"87":2,"88":2,"90":1,"91":1,"92":2,"93":2,
  "94":1,"95":2,"96":2,"97":1,"99":1,
};

const CNAE_ESPECIFICO = {
  "2011":4,"2012":4,"2013":4,"2019":4,"2021":4,"2029":4,
  "2031":4,"2032":4,"2033":4,"2040":4,"2051":4,"2052":4,
  "2061":4,"2062":4,"2063":4,"2071":4,"2072":4,"2073":4,
  "2091":4,"2092":4,"2093":4,"2094":4,"2099":4,
  "2411":4,"2422":4,"2431":4,"2439":4,"2441":4,"2442":4,
  "2443":4,"2449":4,"8011":3,"8012":3,"8020":3,
  "8121":2,"8122":2,"8129":2,
  "8610":3,"8621":3,"8622":3,"8630":2,"8640":2,
  "8650":2,"8660":2,"8690":2,
};

const RISCO_LABEL = {
  1:"Grau 1 — Baixo Risco",
  2:"Grau 2 — Médio Risco",
  3:"Grau 3 — Alto Risco",
  4:"Grau 4 — Muito Alto Risco",
};

function getCNAERisco(cnae) {
  if (!cnae) return null;
  const c = String(cnae).replace(/[^0-9]/g,"");
  return CNAE_ESPECIFICO[c.slice(0,4)] || CNAE_RISCO[c.slice(0,2)] || null;
}

function getServicos(grau, func) {
  const f = parseInt(func)||0;
  const s = ["PGR"];
  if (grau>=2||f>=20) s.push("PCMSO");
  if (grau>=3) s.push("LTCAT","Laudo de Insalubridade");
  if (grau>=4) s.push("PPRA","Laudo de Periculosidade");
  if (f>=50)   s.push("CIPA");
  if (f>=20)   s.push("Treinamentos NR");
  s.push("PPP","ASO");
  return [...new Set(s)];
}

// ── Busca CNPJ na API pública da Receita ──
function buscaCNPJ(cnpj) {
  return new Promise((resolve) => {
    const digits = cnpj.replace(/\D/g,"");
    if (digits.length !== 14) { resolve(null); return; }
    const options = {
      hostname: "brasilapi.com.br",
      path: `/api/cnpj/v1/${digits}`,
      method: "GET",
      timeout: 10000,
      headers: { "User-Agent": "RiseSST/2.0", "Accept": "application/json" },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ── Busca Google Meu Negócio via Anthropic web search ──
function buscaGMB(nome, cidade, cnpj, atividade) {
  return new Promise((resolve, reject) => {
    const prompt = `Busque informações desta empresa brasileira no Google, Google Meu Negócio e WhatsApp Business:
Nome: ${nome}
CNPJ: ${cnpj||""}
Cidade: ${cidade||""}
Atividade: ${atividade||""}

Faça as seguintes buscas:
1. "${nome} ${cidade} telefone whatsapp email site" no Google
2. "${nome} ${cidade}" no Google Meu Negócio
3. "${nome} ${cidade} whatsapp" para encontrar número do WhatsApp
4. Se tiver site da empresa, busque o contato na página

Para o WhatsApp: procure links "wa.me/55...", "api.whatsapp.com/send?phone=55..." ou menção de "WhatsApp: (XX) XXXXX-XXXX" no site ou Google.

Retorne APENAS JSON puro:
{
  "gmb_nome": "nome oficial ou null",
  "gmb_telefone": "telefone com DDD (somente números) ou null",
  "gmb_whatsapp": "número WhatsApp com código do país ex: 5511999999999 ou null",
  "gmb_email": "email ou null",
  "gmb_site": "URL do site ou null",
  "gmb_endereco": "endereço completo ou null",
  "gmb_cidade": "cidade - UF ou null",
  "gmb_rating": "ex: 4.5 ou null",
  "gmb_reviews": "número inteiro ou null",
  "gmb_horario": "ex: Seg-Sex 8h-18h ou null",
  "gmb_categoria": "categoria do negócio ou null"
}`;

    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      system: "Agente de busca de dados empresariais brasileiros. Retorne APENAS JSON puro sem texto antes ou depois.",
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      timeout: 55000,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
        "Content-Length": Buffer.byteLength(body, "utf8"),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const textBlock = parsed.content?.find(b => b.type === "text");
          const raw = textBlock?.text || "";
          const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
          if (s !== -1 && e !== -1) {
            try { resolve(JSON.parse(raw.substring(s, e+1))); return; }
            catch(e2) {}
          }
          resolve({});
        } catch(e) { resolve({}); }
      });
    });
    req.on("error", () => resolve({}));
    req.on("timeout", () => { req.destroy(); resolve({}); });
    req.write(body);
    req.end();
  });
}

// ── Vercel Handler ──
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST")    { res.status(405).end(); return; }

  let body = "";
  await new Promise(r => { req.on("data", c => body += c); req.on("end", r); });
  let payload = {};
  try { payload = JSON.parse(body); } catch(e) { res.status(400).json({error:"Body inválido"}); return; }

  const { nome, cnpj, cidade, atividade, funcionarios } = payload;
  if (!nome && !cnpj) { res.status(400).json({error:"nome ou cnpj obrigatório"}); return; }

  // ── 1. Buscar dados na Receita Federal (BrasilAPI) ──
  let receitaData = null;
  if (cnpj) {
    receitaData = await buscaCNPJ(cnpj);
  }

  // ── 2. Extrair CNAE e calcular grau de risco ──
  let cnaeCode = null, cnaeDesc = null, grauRisco = null;

  if (receitaData) {
    // CNAE principal da Receita
    const cnaePrincipal = receitaData.cnae_fiscal || receitaData.cnae_fiscal_principal?.codigo;
    if (cnaePrincipal) {
      cnaeCode = String(cnaePrincipal).replace(/[^0-9]/g,"");
      cnaeDesc = receitaData.cnae_fiscal_principal?.descricao
        || receitaData.descricao_atividade_principal
        || atividade || "";
      grauRisco = getCNAERisco(cnaeCode);
    }
    // Atualizar funcionários da Receita se não tiver
    if (!funcionarios && receitaData.porte) {
      // porte: MEI, ME, EPP, DEMAIS
    }
  }

  // Fallback: tentar pelo CNAE da atividade descrita
  if (!grauRisco && atividade) {
    // Mapeamento por palavras-chave da atividade
    const atv = atividade.toLowerCase();
    if (/constru|obra|civil|engenharia/.test(atv))        grauRisco = 3;
    else if (/metal|solda|fundição|torneiro/.test(atv))   grauRisco = 3;
    else if (/quím|petroquím|refin|explosivo/.test(atv))  grauRisco = 4;
    else if (/mineração|extrat|pedreira/.test(atv))       grauRisco = 4;
    else if (/elétric|energia|alta tensão/.test(atv))     grauRisco = 4;
    else if (/saúde|hospital|clínica|médic/.test(atv))    grauRisco = 2;
    else if (/comércio|varejo|atacado/.test(atv))         grauRisco = 2;
    else if (/tecnologia|software|ti |informática/.test(atv)) grauRisco = 1;
    else if (/escritório|contabil|advocacia/.test(atv))   grauRisco = 1;
    else if (/transporte|logística|frota/.test(atv))      grauRisco = 2;
    else if (/limpeza|conservação|higieniz/.test(atv))    grauRisco = 2;
    else if (/segurança|vigilância/.test(atv))            grauRisco = 3;
    else if (/aliment|restaurante|cozinha/.test(atv))     grauRisco = 2;
    else                                                   grauRisco = 2; // default médio
  }

  // ── 3. Buscar Google Meu Negócio (em paralelo com Receita) ──
  const gmbData = process.env.ANTHROPIC_API_KEY
    ? await buscaGMB(nome || receitaData?.razao_social || "", cidade, cnpj, atividade)
    : {};

  // ── 4. Montar resposta enriquecida ──
  const numFunc = parseInt(funcionarios) || 0;
  const servicos = grauRisco ? getServicos(grauRisco, numFunc) : [];

  const result = {
    // Dados da Receita Federal
    receita_razao_social: receitaData?.razao_social || null,
    receita_nome_fantasia: receitaData?.nome_fantasia || null,
    receita_situacao: receitaData?.descricao_situacao_cadastral || null,
    receita_porte: receitaData?.porte || null,
    receita_abertura: receitaData?.data_inicio_atividade || null,
    receita_capital: receitaData?.capital_social || null,
    receita_logradouro: receitaData ? `${receitaData.logradouro||""}, ${receitaData.numero||""} ${receitaData.complemento||""} - ${receitaData.bairro||""}, ${receitaData.municipio||""} - ${receitaData.uf||""}`.replace(/,\s*,/g,",").trim() : null,
    receita_cep: receitaData?.cep || null,
    receita_telefone: receitaData?.ddd_telefone_1 ? `(${receitaData.ddd_telefone_1}) ${receitaData.telefone_1||""}`.trim() : null,
    receita_email: receitaData?.email || null,

    // CNAE e Grau de Risco
    cnae_codigo: cnaeCode ? cnaeCode.replace(/(\d{2})(\d{2})(\d)(\d{2})/,"$1.$2-$3/$4") : null,
    cnae_descricao: cnaeDesc || null,
    cnae_grau_risco: grauRisco,
    cnae_grau_label: grauRisco ? RISCO_LABEL[grauRisco] : null,
    cnae_servicos_sst: servicos,

    // CNAEs secundários
    cnaes_secundarios: receitaData?.cnaes_secundarios
      ? receitaData.cnaes_secundarios.slice(0,3).map(c => `${c.codigo} - ${c.descricao}`).join(" | ")
      : null,

    // Google Meu Negócio
    ...gmbData,
  };

  // Limpar nulos
  Object.keys(result).forEach(k => {
    if (result[k] === null || result[k] === undefined || result[k] === "") delete result[k];
  });

  res.status(200).json(result);
};
