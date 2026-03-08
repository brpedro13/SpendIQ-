// Remove aspas de variáveis de ambiente
function cleanEnv(val) {
    if (typeof val === 'string') {
        return val.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
    return val;
}
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '5mb' }));
app.use(express.static('dashboard'));

// ============================================================
// ENV & AI CONFIG
// ============================================================

async function loadEnv() {
    try {
        const envContent = await fs.readFile(path.join(__dirname, '.env'), 'utf8');
        const vars = {};
        for (const line of envContent.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex > 0) {
                vars[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
            }
        }
        return vars;
    } catch {
        return {};
    }
}

async function getAiConfig() {
    const env = await loadEnv();
    // Use variáveis do Railway se existirem, limpando aspas
    const AI_PROVIDER = cleanEnv(process.env.AI_PROVIDER || env.AI_PROVIDER || 'groq');
    const AI_MODEL = cleanEnv(process.env.AI_MODEL || env.AI_MODEL || 'llama-3.3-70b-versatile');
    const GROQ_API_KEY = cleanEnv(process.env.GROQ_API_KEY || env.GROQ_API_KEY || null);
    const ANTHROPIC_API_KEY = cleanEnv(process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || null);

    if (AI_PROVIDER.toLowerCase() === 'anthropic') {
        return {
            provider: 'anthropic',
            apiKey: ANTHROPIC_API_KEY,
            model: AI_MODEL || 'claude-sonnet-4-20250514',
            baseUrl: 'https://api.anthropic.com/v1/messages',
        };
    }

    return {
        provider: 'groq',
        apiKey: GROQ_API_KEY,
        model: AI_MODEL,
        baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    };
}

// ============================================================
// CALL AI
// ============================================================

async function callAi(prompt, config) {
    if (config.provider === 'anthropic') {
        const response = await fetch(config.baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: config.model,
                max_tokens: 4096,
                messages: [{ role: 'user', content: prompt }]
            })
        });
        if (!response.ok) throw new Error(`Anthropic API ${response.status}: ${await response.text()}`);
        const data = await response.json();
        return data.content.find(c => c.type === 'text')?.text || '';
    }

    // Groq / OpenAI-compatible
    const response = await fetch(config.baseUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
            model: config.model,
            messages: [
                { role: 'system', content: 'Você é um assistente financeiro brasileiro especializado em categorizar extratos bancários. Responda SOMENTE com JSON válido. Sem markdown, sem backticks, sem texto antes ou depois do JSON.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.1,
            max_tokens: 4096
        })
    });

    if (!response.ok) throw new Error(`${config.provider} API ${response.status}: ${await response.text()}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
}

// ============================================================
// ROUTES
// ============================================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
});

app.get('/data/merged.json', async (req, res) => {
    try {
        const data = await fs.readFile(path.join(__dirname, 'data', 'merged.json'), 'utf8');
        res.json(JSON.parse(data));
    } catch { res.json([]); }
});

app.get('/api/data/merged', async (req, res) => {
    try {
        const data = await fs.readFile(path.join(__dirname, 'data', 'merged.json'), 'utf8');
        res.json(JSON.parse(data));
    } catch {
        res.json([]);
    }
});

app.post('/api/save-override', async (req, res) => {
    try {
        const { key, field, value } = req.body;
        if (!key || !field || !value) return res.status(400).json({ error: 'Missing fields' });

        const overridesPath = path.join(__dirname, 'data', 'overrides.json');
        let overrides;
        try { overrides = JSON.parse(await fs.readFile(overridesPath, 'utf8')); }
        catch { overrides = { description: "Manual overrides", overrides: {}, version: "1.0" }; }

        if (!overrides.overrides[key]) overrides.overrides[key] = {};
        overrides.overrides[key][field] = value;
        await fs.writeFile(overridesPath, JSON.stringify(overrides, null, 2));
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving override:', error);
        res.status(500).json({ error: 'Failed to save override' });
    }
});

// Export all data files as ZIP
app.post('/api/export/files', async (req, res) => {
    try {
        const archiver = (await import('archiver')).default;
        const dataDir = path.join(__dirname, 'data');
        const files = await fs.readdir(dataDir);
        const dataFiles = files.filter(f => f.match(/\.(csv|ofx|json)$/i) && !f.startsWith('.'));

        if (dataFiles.length === 0) {
            return res.status(400).json({ error: 'No files to export' });
        }

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="finance-export-${new Date().toISOString().slice(0,10)}.zip"`);

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('error', (err) => { res.status(500).json({ error: err.message }); });
        archive.pipe(res);

        for (const file of dataFiles) {
            const filePath = path.join(dataDir, file);
            archive.file(filePath, { name: file });
        }

        await archive.finalize();
    } catch (error) {
        console.error('Error exporting files:', error);
        res.status(500).json({ error: 'Failed to export files' });
    }
});

// ============================================================
// AI ENDPOINTS
// ============================================================

app.get('/api/ai/status', async (req, res) => {
    const config = await getAiConfig();
    res.json({ configured: !!config.apiKey, provider: config.provider, model: config.model });
});

// Build prompt for a batch
function buildPrompt(transactionList, existingCategories, existingFor, ignorePatterns) {
    return `Categorize estas transações bancárias brasileiras.

CONTEXTO DO USUÁRIO:
- Este é um casal (Pedro e Ana Luiza) que divide despesas
- O campo "for" indica pra quem é o gasto: "pedro" (padrão), "ambos", "ana luiza"
- NA DÚVIDA, use "for": "pedro"

CATEGORIAS JÁ EXISTENTES: ${existingCategories.length > 0 ? existingCategories.join(', ') : 'nenhuma'}
VALORES "FOR" JÁ EXISTENTES: ${existingFor.length > 0 ? existingFor.join(', ') : 'nenhum'}

PADRÕES JÁ IGNORADOS (NÃO categorizá-los, coloque em suggested_ignores):
${ignorePatterns.length > 0 ? ignorePatterns.map(p => `- "${p}"`).join('\n') : 'nenhum'}

TRANSAÇÕES IMPORTANTES PARA IGNORAR (coloque em suggested_ignores):
- "Pagamento de fatura" → pagamento interno do cartão de crédito
- "Pagamento recebido" → fatura sendo paga, duplica com o débito
- "Resgate RDB" / "Aplicação RDB" → investimento Nubank
- "Estorno de compra" → não é gasto
- "Valor adicionado na conta por cartão de crédito" → movimentação interna
- Transferências do próprio titular (PEDRO BRASIL ALVES LOPES) entre contas
- Qualquer movimentação que NÃO seja um gasto real

TRANSAÇÕES PARA CATEGORIZAR:
${transactionList}

Responda SOMENTE com JSON válido. Formato:
{
  "categorizations": [
        {"index": 1, "description": "desc", "category": "cat", "for": "pedro", "confidence": "high", "reasoning": "motivo curto"}
  ],
  "suggested_rules": [
        {"keyword": "palavra curta", "category": "cat", "for": "pedro", "reasoning": "motivo"}
  ],
  "suggested_ignores": [
    {"keyword": "palavra-chave", "reason": "motivo"}
  ]
}

REGRAS:
- Keywords curtas e minúsculas (ex: "spotify", "burger king", não a descrição inteira)
- Seja conciso no reasoning (máximo 8 palavras)
- Prefira categorias existentes. Crie novas só se necessário
- Transações que NÃO são gastos reais → coloque em suggested_ignores, NÃO em categorizations`;
}

function inferFallbackCategorization(transaction) {
    const description = (transaction?.description || '').toLowerCase();

    let forWhom = 'pedro';
    if (description.includes('ana luiza gonçalves sousa')) {
        forWhom = 'ana luiza';
    } else if (description.includes('pedro brasil alves lopes')) {
        forWhom = 'pedro';
    }

    let category = 'uncategorized';
    if (
        description.includes('transferência') ||
        description.includes('transferencia') ||
        description.includes('pix') ||
        description.includes('reembolso recebido')
    ) {
        category = 'transferencia';
    }

    return {
        category,
        for: forWhom,
        confidence: 'medium',
        reasoning: 'fallback por descrição'
    };
}

// AI auto-categorize (batched)
app.post('/api/ai/categorize', async (req, res) => {
    try {
        const config = await getAiConfig();
        if (!config.apiKey) {
            return res.status(400).json({
                error: config.provider === 'groq'
                    ? 'GROQ_API_KEY não configurada. Chave grátis em https://console.groq.com/keys'
                    : 'ANTHROPIC_API_KEY não configurada.'
            });
        }

        const { transactions } = req.body;
        if (!transactions || transactions.length === 0) {
            return res.status(400).json({ error: 'Nenhuma transação para categorizar.' });
        }

        // Load rules and ignore config for context
        const rulesContent = await fs.readFile(path.join(__dirname, 'config', 'rules.json'), 'utf8');
        const currentRules = JSON.parse(rulesContent);
        const existingCategories = [...new Set(Object.values(currentRules).map(r => r.category))];
        const existingFor = [...new Set(Object.values(currentRules).map(r => r.for))];

        let ignorePatterns = [];
        try {
            const ignoreContent = await fs.readFile(path.join(__dirname, 'config', 'ignore.json'), 'utf8');
            const ignoreConfig = JSON.parse(ignoreContent);
            ignorePatterns = (ignoreConfig.rules || []).map(r => r.value);
        } catch {}

        // Deduplicate by description
        const uniqueDescs = new Map();
        for (const t of transactions) {
            const key = t.description.toLowerCase().trim();
            if (!uniqueDescs.has(key)) uniqueDescs.set(key, t);
        }
        const uniqueTransactions = [...uniqueDescs.values()];

        // Batch into groups of 15
        const BATCH_SIZE = 15;
        const batches = [];
        for (let i = 0; i < uniqueTransactions.length; i += BATCH_SIZE) {
            batches.push(uniqueTransactions.slice(i, i + BATCH_SIZE));
        }

        console.log(`🤖 [${config.provider}/${config.model}] ${transactions.length} transações → ${uniqueTransactions.length} únicas → ${batches.length} lotes`);

        const allCategorizations = [];
        const allRules = [];
        const allIgnores = [];
        const ruleKeywords = new Set();
        const ignoreKeywords = new Set();

        for (let b = 0; b < batches.length; b++) {
            const batch = batches[b];
            const transactionList = batch.map((t, i) =>
                `${i + 1}. "${t.description}" | R$ ${Math.abs(t.value).toFixed(2)} | ${t.date} | ${t.value > 0 ? 'RECEBIMENTO' : 'GASTO'}`
            ).join('\n');

            const prompt = buildPrompt(transactionList, existingCategories, existingFor, ignorePatterns);
            console.log(`  📦 Lote ${b + 1}/${batches.length} (${batch.length} transações)...`);

            const responseText = await callAi(prompt, config);
            const cleanJson = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

            try {
                const batchResult = JSON.parse(cleanJson);
                for (const cat of (batchResult.categorizations || [])) allCategorizations.push(cat);
                for (const rule of (batchResult.suggested_rules || [])) {
                    const k = rule.keyword.toLowerCase();
                    if (!ruleKeywords.has(k)) { ruleKeywords.add(k); allRules.push(rule); }
                }
                for (const ig of (batchResult.suggested_ignores || [])) {
                    const k = ig.keyword.toLowerCase();
                    if (!ignoreKeywords.has(k)) { ignoreKeywords.add(k); allIgnores.push(ig); }
                }
            } catch (parseErr) {
                console.error(`  ❌ Erro lote ${b + 1}:`, parseErr.message);
            }

            if (b < batches.length - 1) await new Promise(r => setTimeout(r, 500));
        }

        // Expand categorizations to ALL transactions
        const descToCat = new Map();
        for (const cat of allCategorizations) {
            descToCat.set(cat.description.toLowerCase().trim(), cat);
        }

        const expandedCategorizations = transactions.map((t, i) => {
            const match = descToCat.get(t.description.toLowerCase().trim());
            if (match) return { ...match, index: i + 1, description: t.description };
            const fallback = inferFallbackCategorization(t);
            return {
                index: i + 1,
                description: t.description,
                category: fallback.category,
                for: fallback.for,
                confidence: fallback.confidence,
                reasoning: fallback.reasoning
            };
        });

        const result = { categorizations: expandedCategorizations, suggested_rules: allRules, suggested_ignores: allIgnores };
        console.log(`✅ ${expandedCategorizations.length} categorizadas | 📝 ${allRules.length} regras | 🚫 ${allIgnores.length} ignores`);
        res.json(result);

    } catch (error) {
        console.error('AI categorization error:', error);
        res.status(500).json({ error: `Erro ao categorizar: ${error.message}` });
    }
});

// Apply AI-suggested rules
app.post('/api/ai/apply-rules', async (req, res) => {
    try {
        const { rules, ignores } = req.body;

        if (rules && rules.length > 0) {
            const rulesPath = path.join(__dirname, 'config', 'rules.json');
            const currentRules = JSON.parse(await fs.readFile(rulesPath, 'utf8'));
            for (const rule of rules) {
                currentRules[rule.keyword.toLowerCase()] = { category: rule.category, for: rule.for };
            }
            await fs.writeFile(rulesPath, JSON.stringify(currentRules, null, 2));
            console.log(`✅ +${rules.length} regras no rules.json`);
        }

        if (ignores && ignores.length > 0) {
            const ignorePath = path.join(__dirname, 'config', 'ignore.json');
            let ignoreConfig;
            try { ignoreConfig = JSON.parse(await fs.readFile(ignorePath, 'utf8')); }
            catch { ignoreConfig = { description: "Ignore rules", rules: [] }; }

            for (const ignore of ignores) {
                const exists = ignoreConfig.rules.some(r => r.value.toLowerCase() === ignore.keyword.toLowerCase());
                if (!exists) {
                    ignoreConfig.rules.push({ type: "description_contains", value: ignore.keyword, reason: ignore.reason });
                }
            }
            await fs.writeFile(ignorePath, JSON.stringify(ignoreConfig, null, 2));
            console.log(`✅ +${ignores.length} regras no ignore.json`);
        }

        res.json({ success: true, rulesAdded: rules?.length || 0, ignoresAdded: ignores?.length || 0 });
    } catch (error) {
        console.error('Error applying rules:', error);
        res.status(500).json({ error: 'Failed to apply rules' });
    }
});

// Apply AI categorizations as overrides
app.post('/api/ai/apply-categorizations', async (req, res) => {
    try {
        const { categorizations, transactionKeys } = req.body;
        const overridesPath = path.join(__dirname, 'data', 'overrides.json');
        let overrides;
        try { overrides = JSON.parse(await fs.readFile(overridesPath, 'utf8')); }
        catch { overrides = { description: "Manual overrides", overrides: {}, version: "1.0" }; }

        let applied = 0;
        for (let i = 0; i < categorizations.length; i++) {
            const cat = categorizations[i];
            const key = transactionKeys[i];
            if (key && cat.category !== 'uncategorized') {
                overrides.overrides[key] = { category: cat.category, for: cat.for };
                applied++;
            }
        }

        await fs.writeFile(overridesPath, JSON.stringify(overrides, null, 2));
        res.json({ success: true, applied });
    } catch (error) {
        console.error('Error applying categorizations:', error);
        res.status(500).json({ error: 'Failed to apply categorizations' });
    }
});

// Forget AI memory (rules, ignores and overrides) and rebuild merged data
app.post('/api/ai/forget-all', async (req, res) => {
    try {
        const rulesPath = path.join(__dirname, 'config', 'rules.json');
        const ignorePath = path.join(__dirname, 'config', 'ignore.json');
        const overridesPath = path.join(__dirname, 'data', 'overrides.json');

        const essentialIgnoreRules = [
            {
                type: 'description_contains',
                value: 'Pagamento de fatura',
                reason: 'Pagamento de fatura do cartão (transferência interna)'
            },
            {
                type: 'description_contains',
                value: 'Pagamento recebido',
                reason: 'Pagamento da fatura recebido (duplica com débito)'
            },
            {
                type: 'description_contains',
                value: 'Aplicação RDB',
                reason: 'Aplicação em investimento Nubank'
            },
            {
                type: 'description_contains',
                value: 'Resgate RDB',
                reason: 'Resgate de investimento Nubank'
            },
            {
                type: 'description_contains',
                value: 'Estorno de compra',
                reason: 'Estorno - não é gasto real'
            },
            {
                type: 'description_contains',
                value: 'Valor adicionado na conta por cartão de crédito',
                reason: 'Movimentação interna - crédito adicionado para Pix'
            },
            {
                type: 'description_contains',
                value: 'PEDRO BRASIL ALVES LOPES',
                reason: 'Transferência própria entre contas'
            }
        ];

        const emptyRules = {};
        const emptyIgnore = {
            description: 'Configuration for ignoring specific transactions',
            rules: essentialIgnoreRules
        };
        const emptyOverrides = {
            description: 'Manual overrides',
            overrides: {},
            version: '1.0'
        };

        await fs.writeFile(rulesPath, JSON.stringify(emptyRules, null, 2));
        await fs.writeFile(ignorePath, JSON.stringify(emptyIgnore, null, 2));
        await fs.writeFile(overridesPath, JSON.stringify(emptyOverrides, null, 2));

        await runParse();

        res.json({
            success: true,
            message: 'Memória da IA limpa com ignores essenciais preservados e dados reprocessados.'
        });
    } catch (error) {
        console.error('Error forgetting AI memory:', error);
        res.status(500).json({ error: `Falha ao limpar memória: ${error.message}` });
    }
});

// AI Insights endpoint
app.post('/api/ai/insights', async (req, res) => {
    try {
        const config = await getAiConfig();
        if (!config.apiKey) {
            return res.status(400).json({ error: 'Chave de IA não configurada.' });
        }
        const { transactions } = req.body;
        if (!transactions || transactions.length === 0) {
            return res.status(400).json({ error: 'Nenhuma transação enviada.' });
        }
        // Prepare summary for prompt
        const summary = summarizeTransactionsForInsight(transactions);
        const prompt =
    `Você é um analista financeiro brasileiro. Analise o resumo de gastos abaixo e aponte, de forma objetiva e direta:
    1. Os problemas e gargalos mais críticos das finanças, identificando onde estão os maiores gastos e quais serviços/estabelecimentos mais pesam no orçamento.
    2. Tendências e variações relevantes nos gastos mensais, como meses em que o gasto ficou acima ou abaixo do normal, ou aumentos/reduções significativos.
    NÃO forneça soluções, dicas ou sugestões. Apenas descreva os pontos críticos, tendências e os principais responsáveis pelos maiores gastos, sem rodeios, sem conselhos, sem sugestões milagrosas. Use exemplos reais dos dados. Responda em até 5 tópicos.

    Resumo dos gastos:
    ${summary}

    Responda SOMENTE com texto, sem markdown, sem JSON, sem rodeios, sem sugestões.`;
        const insight = await callAi(prompt, config);
        res.json({ insight });
    } catch (error) {
        console.error('AI insights error:', error);
        res.status(500).json({ error: `Erro ao gerar insights: ${error.message}` });
    }
});

function summarizeTransactionsForInsight(transactions) {
    // Aggregate outflows/inflows for a cashflow-aware summary
    const byCategory = {};
    const byPersonOutflow = {};
    const byCategoryService = {};
    let totalOutflow = 0;
    let totalInflow = 0;
    for (const t of transactions) {
        const cat = t.category || 'uncategorized';
        const who = t.for || 'unknown';
        const service = (t.service || t.establishment || t.description || '').toLowerCase().trim();
        const value = Number(t.value) || 0;
        if (value < 0) {
            const abs = Math.abs(value);
            byCategory[cat] = (byCategory[cat] || 0) + abs;
            byPersonOutflow[who] = (byPersonOutflow[who] || 0) + abs;
            if (!byCategoryService[cat]) byCategoryService[cat] = {};
            byCategoryService[cat][service] = (byCategoryService[cat][service] || 0) + abs;
            totalOutflow += abs;
        } else if (value > 0) {
            totalInflow += value;
        }
    }

    // Top 3 categories
    const topCategoriesArr = Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).slice(0,3);
    const topCat = topCategoriesArr.map(([k,v])=>`${k}: R$ ${v.toFixed(2)}`).join('; ');

    // Para cada top categoria, pegar os 2-3 principais serviços/estabelecimentos
    let topServicesDetails = '';
    for (const [cat, _] of topCategoriesArr) {
        const services = byCategoryService[cat];
        const topServices = Object.entries(services).sort((a,b)=>b[1]-a[1]).slice(0,3);
        if (topServices.length > 0) {
            topServicesDetails += `\n  - ${cat}: ` + topServices.map(([svc, val]) => `${svc}: R$ ${val.toFixed(2)}`).join('; ');
        }
    }

    // Top 3 people
    const topPerson = Object.entries(byPersonOutflow).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}: R$ ${v.toFixed(2)}`).join('; ');

    // Recent months
    const byMonth = {};
    for (const t of transactions) {
        const value = Number(t.value) || 0;
        if (value >= 0) continue;
        const d = new Date(t.date);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        byMonth[key] = (byMonth[key] || 0) + Math.abs(value);
    }
    const lastMonths = Object.entries(byMonth).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,3).map(([k,v])=>`${k}: R$ ${v.toFixed(2)}`).join('; ');

    const net = totalInflow - totalOutflow;
    return `Saídas: R$ ${totalOutflow.toFixed(2)} | Entradas: R$ ${totalInflow.toFixed(2)} | Líquido: R$ ${net.toFixed(2)} | Top categorias (saída): ${topCat}\nPrincipais serviços/estabelecimentos por categoria:${topServicesDetails}\nTop pessoas (saída): ${topPerson} | Últimos meses (saída): ${lastMonths}`;
}

// Start
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    getAiConfig().then(c => {
        console.log(`🤖 AI: ${c.provider}/${c.model} | Key: ${c.apiKey ? '✅' : '❌'}`);
    });

    // Check Gmail sync availability
    checkGmailSync();

    // Auto-sync every 6 hours
    setInterval(autoSync, 6 * 60 * 60 * 1000);
});

// ============================================================
// GMAIL SYNC + AUTO-IMPORT
// ============================================================

async function checkGmailSync() {
    const clientId = cleanEnv(process.env.GOOGLE_CLIENT_ID);
    const clientSecret = cleanEnv(process.env.GOOGLE_CLIENT_SECRET);
    const refreshToken = cleanEnv(process.env.GOOGLE_REFRESH_TOKEN);
    if (clientId && clientSecret && refreshToken) {
        console.log('📬 Gmail sync: ✅ configurado');
    } else {
        console.log('📬 Gmail sync: ❌ não configurado (rode: node scripts/gmail-auth.js)');
    }
}

async function runParse() {
    const { execSync } = await import('node:child_process');
    execSync('node scripts/parse.js', { cwd: __dirname, stdio: 'inherit' });
    // Copy to dashboard
    const src = path.join(__dirname, 'data', 'merged.json');
    const dst = path.join(__dirname, 'dashboard', 'data', 'merged.json');
    await fs.copyFile(src, dst);
}

async function isMergedEmpty() {
    try {
        const raw = await fs.readFile(path.join(__dirname, 'data', 'merged.json'), 'utf8');
        const parsed = JSON.parse(raw);
        return !Array.isArray(parsed) || parsed.length === 0;
    } catch {
        return true;
    }
}

async function autoSync() {
    const clientId = cleanEnv(process.env.GOOGLE_CLIENT_ID);
    const clientSecret = cleanEnv(process.env.GOOGLE_CLIENT_SECRET);
    const refreshToken = cleanEnv(process.env.GOOGLE_REFRESH_TOKEN);
    if (!(clientId && clientSecret && refreshToken)) {
        return; // Gmail not configured, skip
    }

    console.log('\n⏰ Auto-sync iniciando...');
    try {
        const { syncFromGmail } = await import('./scripts/gmail-sync.js');
        const result = await syncFromGmail();
        if (result.newFiles > 0) {
            console.log('🔄 Novos arquivos encontrados, re-parseando...');
            await runParse();
            console.log('✅ Auto-sync concluído com novos dados!');
        } else {
            console.log('✅ Auto-sync: nenhum arquivo novo');
        }
    } catch (err) {
        console.error('❌ Auto-sync erro:', err.message);
    }
}

// Manual sync endpoint
app.post('/api/sync', async (req, res) => {
    try {
        const forceRecovery = await isMergedEmpty();
        const { syncFromGmail } = await import('./scripts/gmail-sync.js');
        const result = await syncFromGmail({ forceRecovery });

        const reparsedBecauseEmpty = result.newFiles === 0 && await isMergedEmpty();
        if (result.newFiles > 0 || reparsedBecauseEmpty) {
            await runParse();
        }

        res.json({
            success: true,
            newFiles: result.newFiles,
            totalEmails: result.totalEmails,
            reparsed: result.newFiles > 0 || reparsedBecauseEmpty
        });
    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Check sync status (compatível com Railway)
app.get('/api/sync/status', async (req, res) => {
    // Usa cleanEnv para garantir compatibilidade com aspas
    const clientId = cleanEnv(process.env.GOOGLE_CLIENT_ID);
    const clientSecret = cleanEnv(process.env.GOOGLE_CLIENT_SECRET);
    const refreshToken = cleanEnv(process.env.GOOGLE_REFRESH_TOKEN);
    const gmailConfigured = !!(clientId && clientSecret && refreshToken);
    let lastSync = null;
    try {
        const state = JSON.parse(await fs.readFile(
            path.join(__dirname, 'data', '.gmail-sync-state.json'), 'utf8'
        ));
        lastSync = state.lastSync;
    } catch {}
    res.json({ gmailConfigured, lastSync });
});