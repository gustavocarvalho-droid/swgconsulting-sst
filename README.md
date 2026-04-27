# SWG Consulting SST — Sistema Unificado

Sistema completo de gestão comercial para empresas de Saúde e Segurança do Trabalho (SST), desenvolvido para a **SWG Consulting**.

## 🚀 Módulos Integrados

| Módulo | Descrição |
|--------|-----------|
| 🔍 **Buscador de Empresas** | Busca empresas com CNPJ confirmado via IA + web search |
| 📱 **WhatsApp Disparos** | Envio em massa, listas, agendamentos e conversas |
| 📋 **CRM** | Pipeline Kanban por origem: Buscador, ZapDisparos, Empresa |
| 🤖 **SWG IA** | IA especializada em SST para vendas, diagnóstico e propostas |
| 📊 **Histórico** | Rastreamento de todas as atividades da plataforma |
| 📈 **Análise Completa** | Score de desempenho + plano de ação com IA |

## ⚙️ Deploy na Vercel

### 1. Fork/Clone no GitHub
```bash
git clone https://github.com/sua-org/swg-sst.git
cd swg-sst
```

### 2. Deploy na Vercel
1. Acesse [vercel.com](https://vercel.com) e importe o repositório
2. Configure as variáveis de ambiente:

```env
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
```

### 3. Banco de Dados Neon
1. Crie uma conta em [neon.tech](https://neon.tech)
2. Crie um projeto → copie a `DATABASE_URL`
3. Cole na Vercel em Settings → Environment Variables
4. As tabelas são criadas automaticamente na primeira execução

## 🗄️ Estrutura do Projeto

```
swg-sst/
├── index.html          # Frontend completo (SPA)
├── api/
│   ├── buscar.js       # Buscador de empresas via Claude + web search
│   ├── dados.js        # CRUD genérico — Neon PostgreSQL
│   ├── enriquecer.js   # Enriquecimento CNPJ + Google Meu Negócio
│   ├── ia.js           # Proxy seguro para Anthropic API
│   └── usuarios.js     # Gestão multi-tenant de usuários
├── vercel.json         # Configuração Vercel
├── package.json
└── .env.example        # Variáveis de ambiente necessárias
```

## 🔐 Login Padrão

| Campo | Valor |
|-------|-------|
| Usuário | `gustavo1996c` |
| Senha | `1996` |

> ⚠️ Altere a senha após o primeiro acesso em **Configurações → Segurança**

## 📦 Tecnologias

- **Frontend**: HTML/CSS/JS puro (SPA zero-dependência)
- **Backend**: Node.js Serverless (Vercel Functions)
- **IA**: Claude Sonnet 4 via Anthropic API
- **Banco**: Neon PostgreSQL (serverless)
- **WhatsApp**: Evolution API (self-hosted)

## 🔑 APIs Externas Necessárias

1. **Anthropic** — [console.anthropic.com](https://console.anthropic.com) — para Buscador e SWG IA
2. **Neon DB** — [neon.tech](https://neon.tech) — banco de dados na nuvem (gratuito)
3. **Evolution API** — para envio de WhatsApp (configurar em WhatsApp → Configurações)

## 💡 Funcionalidades Completas

### Buscador de Empresas
- Busca por setor, localidade ou tipo de empresa
- CNPJ verificado em fontes oficiais
- Enriquecimento com dados da Receita Federal + Google Meu Negócio
- Classificação por Grau de Risco CNAE (NR-4)
- Exportação CSV/JSON
- Histórico completo de todas as buscas

### WhatsApp Disparos
- Importação via planilha Excel/CSV
- Disparos com intervalo humanizado (anti-ban)
- Agendamentos futuros
- Listas segmentadas
- Conversas em tempo real
- Relatório com taxa de sucesso

### CRM com 3 Pipelines
- **CRM Buscador**: leads do buscador
- **CRM ZapDisparos**: leads do WhatsApp
- **CRM Empresa**: pipeline interno
- Kanban + Tabela
- Histórico de movimentações
- Próximas ações com alertas

### SWG IA
- 7 modos: Comercial, Diagnóstico, Objeções, Proposta, Script, Follow-up, Base SST
- Chips de ação rápida
- Histórico de conversas salvo no banco
- Sistema de prompt especializado em SST

---

**SWG Consulting** · contato: gustavo.carvalho@swgconsulting.com.br
