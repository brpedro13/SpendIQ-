// Global variables
let transactions = [];
let filteredTransactions = [];
let currentSort = { column: null, direction: 'asc' };

// Chart instances
let categoryChart = null;
let personChart = null;
let monthlyChart = null;

// AI state
let aiResults = null;
let insightsDebounceTimer = null;

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadData();
        setupEventListeners();
        renderDashboard();
        await checkAiStatus();
        setupInsights();
    } catch (error) {
        console.error('Error initializing app:', error);
        showError('Failed to load data. Please make sure merged.json exists.');
    }
});

// Load data from merged.json
async function loadData() {
    try {
        const response = await fetch(`/api/data/merged?t=${Date.now()}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        transactions = await response.json();
        applyLocalStorageOverrides();
        enrichTransactionConfidence();
        filteredTransactions = [...transactions];
        console.log(`Loaded ${transactions.length} transactions`);
    } catch (error) {
        console.error('Error loading data:', error);
        throw error;
    }
}

function enrichTransactionConfidence() {
    transactions = transactions.map((t) => {
        const source = (t.classification_source || '').toLowerCase();
        if (t.manual_override || source === 'manual_override') {
            return { ...t, confidence_level: 'high', confidence_source: 'IA/Manual' };
        }
        if (source === 'rule') {
            return { ...t, confidence_level: 'medium', confidence_source: 'Regra' };
        }
        if (source === 'fallback' || t.category === 'uncategorized' || t.for === 'unknown') {
            return { ...t, confidence_level: 'low', confidence_source: 'Fallback' };
        }
        return { ...t, confidence_level: 'medium', confidence_source: 'Regra' };
    });
}

// Apply overrides from localStorage
function applyLocalStorageOverrides() {
    try {
        const storedOverrides = localStorage.getItem('finance_overrides');
        if (storedOverrides) {
            const overrides = JSON.parse(storedOverrides);
            let overrideCount = 0;
            for (const [key, overrideData] of Object.entries(overrides.overrides || {})) {
                const transaction = transactions.find(t =>
                    `${t.date}|${t.description}|${t.value}` === key
                );
                if (transaction) {
                    if (overrideData.category) { transaction.category = overrideData.category; overrideCount++; }
                    if (overrideData.for) { transaction.for = overrideData.for; overrideCount++; }
                    transaction.manual_override = true;
                }
            }
            if (overrideCount > 0) console.log(`✅ Applied ${overrideCount} overrides from localStorage`);
        }
    } catch (error) {
        console.error('Error applying localStorage overrides:', error);
    }
}

// Setup event listeners
function setupEventListeners() {
    document.getElementById('categoryFilter').addEventListener('change', applyFilters);
    document.getElementById('personFilter').addEventListener('change', applyFilters);
    document.getElementById('yearFilter').addEventListener('change', applyFilters);
    document.getElementById('monthFilter').addEventListener('change', applyFilters);
    document.getElementById('clearFilters').addEventListener('click', clearFilters);
    document.getElementById('exportOverrides').addEventListener('click', exportOverrides);
    document.getElementById('exportFiles').addEventListener('click', exportFiles);

    // AI buttons
    document.getElementById('aiCategorize').addEventListener('click', runAiCategorization);
    document.getElementById('aiForgetAll').addEventListener('click', forgetAllAiMemory);
    document.getElementById('aiApplyAll').addEventListener('click', applyAllAiResults);
    document.getElementById('aiApplyRules').addEventListener('click', applyAiRules);
    document.getElementById('aiDismiss').addEventListener('click', dismissAiResults);
    document.getElementById('gmailSync').addEventListener('click', runGmailSync);

    // Sortable headers
    document.querySelectorAll('.sortable').forEach(header => {
        header.addEventListener('click', () => sortTable(header.dataset.column));
    });

    // Insights
    document.getElementById('refreshInsights').addEventListener('click', runInsightsAnalysis);
}

// Insights Tab Logic
function setupInsights() {
    runInsightsAnalysis();
}

async function runInsightsAnalysis() {
    const loading = document.getElementById('insightsLoading');
    const content = document.getElementById('insightsContent');
    loading.style.display = 'block';
    content.innerHTML = '';
    try {
        const transactionsForInsight = filteredTransactions?.length ? filteredTransactions : transactions;
        // Send summary to backend for AI analysis
        const response = await fetch('/api/ai/insights', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactions: transactionsForInsight })
        });
        if (!response.ok) throw new Error('Erro ao obter insights da IA');
        const result = await response.json();
        content.innerHTML = formatInsightText(result.insight || 'Nenhum insight gerado.');
    } catch (error) {
        content.innerHTML = `<div class="insights-error">${error.message}</div>`;
    } finally {
        loading.style.display = 'none';
    }
}

function scheduleInsightsRefresh() {
    if (insightsDebounceTimer) clearTimeout(insightsDebounceTimer);
    insightsDebounceTimer = setTimeout(() => {
        runInsightsAnalysis();
    }, 500);
}

// Format insight text into readable paragraphs and bullet points
function formatInsightText(text) {
    if (!text) return '';
    // Try to split into topics if possible
    let lines = text.split(/\n|\r/).map(l => l.trim()).filter(Boolean);
    // If the AI used numbers or dashes, convert to bullets
    lines = lines.flatMap(line => {
        if (/^\d+\./.test(line)) return [`<li>${line.replace(/^\d+\.\s*/, '')}</li>`];
        if (/^[-•]/.test(line)) return [`<li>${line.replace(/^[-•]\s*/, '')}</li>`];
        return [line];
    });
    // If there are at least 2 bullet points, wrap as <ul>
    const bullets = lines.filter(l => l.startsWith('<li>'));
    if (bullets.length >= 2) {
        return `<ul class='insights-list'>${bullets.join('')}</ul>`;
    }
    // Otherwise, join as paragraphs
    return `<p class='insights-paragraph'>${lines.join(' ')}</p>`;
}

// ============================================================
// AI CATEGORIZATION
// ============================================================

async function checkAiStatus() {
    try {
        const response = await fetch('/api/ai/status');
        const data = await response.json();
        const btn = document.getElementById('aiCategorize');
        const uncategorized = transactions.filter(t => t.category === 'uncategorized' || t.for === 'unknown');
        const badge = document.getElementById('aiBadge');

        badge.textContent = `${uncategorized.length} sem categoria`;
        badge.className = 'ai-badge' + (uncategorized.length > 0 ? ' ai-badge-warn' : ' ai-badge-ok');

        if (!data.configured) {
            btn.disabled = true;
            const hint = data.provider === 'groq'
                ? '⚠️ <code>GROQ_API_KEY</code> no .env (grátis em <a href="https://console.groq.com/keys" target="_blank" style="color:#64b5f6">console.groq.com</a>)'
                : '⚠️ <code>ANTHROPIC_API_KEY</code> no .env';
            setAiStatus(hint, 'warn');
        } else if (uncategorized.length === 0) {
            btn.disabled = true;
            setAiStatus('✅ Todas as transações já estão categorizadas!', 'success');
        } else {
            btn.disabled = false;
            setAiStatus(`🔍 ${uncategorized.length} aguardando categorização (${data.provider}/${data.model})`, 'info');
        }
    } catch (error) {
        console.error('Error checking AI status:', error);
        setAiStatus('❌ Erro. Use <code>node server.js</code>.', 'error');
    }

    // Check Gmail sync status
    try {
        const syncRes = await fetch('/api/sync/status');
        const syncData = await syncRes.json();
        const syncBtn = document.getElementById('gmailSync');
        if (syncData.gmailConfigured) {
            syncBtn.disabled = false;
            if (syncData.lastSync) {
                const ago = timeSince(new Date(syncData.lastSync));
                syncBtn.title = `Último sync: ${ago}`;
            }
        } else {
            syncBtn.disabled = true;
            syncBtn.title = 'Rode: node scripts/gmail-auth.js';
        }
    } catch {}
}

function timeSince(date) {
    const s = Math.floor((new Date() - date) / 1000);
    if (s < 60) return 'agora';
    if (s < 3600) return `${Math.floor(s / 60)}min atrás`;
    if (s < 86400) return `${Math.floor(s / 3600)}h atrás`;
    return `${Math.floor(s / 86400)}d atrás`;
}

async function runGmailSync() {
    const btn = document.getElementById('gmailSync');
    btn.disabled = true;
    btn.innerHTML = '<span class="ai-spinner"></span> Sincronizando...';
    try {
        const response = await fetch('/api/sync', { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (result.newFiles > 0) {
            showToast(`📬 ${result.newFiles} novos arquivos! Recarregando...`, 'success');
            setTimeout(() => location.reload(), 2000);
        } else {
            showToast(`📬 Nenhum arquivo novo (${result.totalEmails} emails verificados)`, 'info');
        }
    } catch (error) {
        showToast(`❌ Sync: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="ai-btn-icon">📬</span> Sync Gmail';
    }
}

async function forgetAllAiMemory() {
    const btn = document.getElementById('aiForgetAll');
    const confirmed = window.confirm(
        'Isso vai apagar regras e overrides salvos, preservar ignores essenciais (fatura/RDB/estorno), reprocessar os dados e recarregar a tela. Deseja continuar?'
    );
    if (!confirmed) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="ai-spinner"></span> Limpando...';

    try {
        const response = await fetch('/api/ai/forget-all', { method: 'POST' });
        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }

        localStorage.removeItem('finance_overrides');
        showToast('🧹 Memória limpa (com ignores essenciais). Recarregando...', 'success');
        setTimeout(() => location.reload(), 1200);
    } catch (error) {
        showToast(`❌ Erro ao limpar memória: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="ai-btn-icon">🧹</span> Esquecer Tudo';
    }
}

function setAiStatus(html, type) {
    const el = document.getElementById('aiStatus');
    el.innerHTML = html;
    el.className = `ai-status ai-status-${type}`;
}

async function runAiCategorization() {
    const btn = document.getElementById('aiCategorize');
    const uncategorized = transactions.filter(t => t.category === 'uncategorized' || t.for === 'unknown');

    if (uncategorized.length === 0) {
        setAiStatus('✅ Nenhuma transação para categorizar!', 'success');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="ai-spinner"></span> Analisando...';
    setAiStatus(`🤖 Enviando ${uncategorized.length} transações para o Claude...`, 'loading');

    try {
        const response = await fetch('/api/ai/categorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactions: uncategorized })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || `HTTP ${response.status}`);
        }

        aiResults = await response.json();
        aiResults._transactionKeys = uncategorized.map(t => `${t.date}|${t.description}|${t.value}`);
        aiResults._transactions = uncategorized;

        renderAiResults();
        setAiStatus(`✅ IA analisou ${aiResults.categorizations?.length || 0} transações!`, 'success');

    } catch (error) {
        console.error('AI categorization error:', error);
        setAiStatus(`❌ Erro: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="ai-btn-icon">⚡</span> Categorizar com IA';
    }
}

function renderAiResults() {
    if (!aiResults) return;

    const container = document.getElementById('aiResults');
    const body = document.getElementById('aiResultsBody');
    container.style.display = 'block';

    let html = '';

    // Categorizations
    if (aiResults.categorizations?.length > 0) {
        html += '<div class="ai-section"><h5>📋 Categorizações</h5><div class="ai-cards">';
        for (const cat of aiResults.categorizations) {
            const conf = cat.confidence === 'high' ? '🟢' : cat.confidence === 'medium' ? '🟡' : '🔴';
            html += `
                <div class="ai-card">
                    <div class="ai-card-desc">${escapeHtml(cat.description)}</div>
                    <div class="ai-card-tags">
                        <span class="ai-tag ai-tag-cat">${cat.category}</span>
                        <span class="ai-tag ai-tag-for">${cat.for}</span>
                        <span class="ai-tag ai-tag-conf">${conf} ${cat.confidence}</span>
                    </div>
                    <div class="ai-card-reason">${escapeHtml(cat.reasoning || '')}</div>
                </div>`;
        }
        html += '</div></div>';
    }

    // Suggested rules
    if (aiResults.suggested_rules?.length > 0) {
        html += '<div class="ai-section"><h5>📝 Novas Regras Sugeridas</h5><div class="ai-rules-list">';
        for (const rule of aiResults.suggested_rules) {
            html += `
                <div class="ai-rule">
                    <code>"${escapeHtml(rule.keyword)}"</code> → 
                    <span class="ai-tag ai-tag-cat">${rule.category}</span>
                    <span class="ai-tag ai-tag-for">${rule.for}</span>
                    <span class="ai-rule-reason">${escapeHtml(rule.reasoning || '')}</span>
                </div>`;
        }
        html += '</div></div>';
    }

    // Suggested ignores
    if (aiResults.suggested_ignores?.length > 0) {
        html += '<div class="ai-section"><h5>🚫 Sugestões para Ignorar</h5><div class="ai-rules-list">';
        for (const ig of aiResults.suggested_ignores) {
            html += `
                <div class="ai-rule">
                    <code>"${escapeHtml(ig.keyword)}"</code>
                    <span class="ai-rule-reason">${escapeHtml(ig.reason || '')}</span>
                </div>`;
        }
        html += '</div></div>';
    }

    body.innerHTML = html;
}

async function applyAllAiResults() {
    if (!aiResults) return;

    const btn = document.getElementById('aiApplyAll');
    btn.disabled = true;
    btn.textContent = 'Aplicando...';

    try {
        // Apply categorizations as overrides
        const response = await fetch('/api/ai/apply-categorizations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                categorizations: aiResults.categorizations,
                transactionKeys: aiResults._transactionKeys
            })
        });

        const result = await response.json();
        if (!result.success) throw new Error('Falha ao aplicar');

        // Also save to localStorage for immediate effect
        let overrides = { description: "Manual overrides", overrides: {}, version: "1.0" };
        try {
            const stored = localStorage.getItem('finance_overrides');
            if (stored) overrides = JSON.parse(stored);
        } catch {}

        for (let i = 0; i < aiResults.categorizations.length; i++) {
            const cat = aiResults.categorizations[i];
            const key = aiResults._transactionKeys[i];
            if (key && cat.category !== 'uncategorized') {
                overrides.overrides[key] = { category: cat.category, for: cat.for };
                // Update in-memory transactions
                const t = transactions.find(t => `${t.date}|${t.description}|${t.value}` === key);
                if (t) {
                    t.category = cat.category;
                    t.for = cat.for;
                    t.manual_override = true;
                    t.classification_source = 'manual_override';
                    t.confidence_level = 'high';
                    t.confidence_source = 'IA/Manual';
                }
            }
        }
        localStorage.setItem('finance_overrides', JSON.stringify(overrides));

        showToast(`✅ ${result.applied} categorizações aplicadas!`, 'success');

        // Re-render
        filteredTransactions = [...transactions];
        applyFilters();
        checkAiStatus();

    } catch (error) {
        showToast(`❌ Erro: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '✅ Aplicar Tudo';
    }
}

async function applyAiRules() {
    if (!aiResults) return;

    const btn = document.getElementById('aiApplyRules');
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
        const response = await fetch('/api/ai/apply-rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rules: aiResults.suggested_rules || [],
                ignores: aiResults.suggested_ignores || []
            })
        });

        const result = await response.json();
        if (!result.success) throw new Error('Falha ao salvar regras');

        showToast(`📝 ${result.rulesAdded} regras + ${result.ignoresAdded} ignores salvos! Rode npm run parse para aplicar.`, 'success');

    } catch (error) {
        showToast(`❌ Erro: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '📝 Salvar Regras';
    }
}

function dismissAiResults() {
    document.getElementById('aiResults').style.display = 'none';
    aiResults = null;
}

// ============================================================
// DASHBOARD RENDERING (existing code)
// ============================================================

function renderDashboard() {
    renderStats();
    renderFinancialAlerts();
    populateFilters();
    applyFilters();
}

function renderFinancialAlerts() {
    const container = document.getElementById('alertsList');
    if (!container) return;

    const outflows = filteredTransactions.filter(t => Number(t.value) < 0);
    const alerts = [];

    // Alert 1: transporte month-over-month spike
    const transportByMonth = {};
    for (const t of outflows.filter(t => (t.category || '').toLowerCase().includes('transporte'))) {
        const d = new Date(t.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        transportByMonth[key] = (transportByMonth[key] || 0) + Math.abs(Number(t.value));
    }
    const months = Object.keys(transportByMonth).sort();
    if (months.length >= 2) {
        const last = months[months.length - 1];
        const prev = months[months.length - 2];
        const lastValue = transportByMonth[last] || 0;
        const prevValue = transportByMonth[prev] || 0;
        if (prevValue > 0) {
            const changePct = ((lastValue - prevValue) / prevValue) * 100;
            if (changePct >= 30) {
                alerts.push({
                    type: 'warning',
                    title: 'Transporte subiu forte',
                    body: `${last}: +${changePct.toFixed(1)}% vs ${prev} (R$ ${lastValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`
                });
            }
        }
    }

    // Alert 2: outliers above dynamic threshold
    const values = outflows.map(t => Math.abs(Number(t.value))).filter(v => Number.isFinite(v));
    if (values.length >= 8) {
        const avg = values.reduce((s, v) => s + v, 0) / values.length;
        const variance = values.reduce((s, v) => s + ((v - avg) ** 2), 0) / values.length;
        const std = Math.sqrt(variance);
        const threshold = Math.max(100, avg + 2 * std);
        const outlier = outflows
            .filter(t => Math.abs(Number(t.value)) >= threshold)
            .sort((a, b) => Math.abs(Number(b.value)) - Math.abs(Number(a.value)))[0];
        if (outlier) {
            alerts.push({
                type: 'info',
                title: 'Gasto atipico detectado',
                body: `${formatDate(new Date(outlier.date))} - ${outlier.description} (R$ ${Math.abs(Number(outlier.value)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`
            });
        }
    }

    if (alerts.length === 0) {
        container.innerHTML = `<div class="alert-empty">Sem alertas relevantes no filtro atual.</div>`;
        return;
    }

    container.innerHTML = alerts.map(a => `
        <div class="alert-card ${a.type}">
            <div class="alert-title">${a.title}</div>
            <div class="alert-body">${a.body}</div>
        </div>
    `).join('');
}

function renderStats() {
    const totalTransactions = filteredTransactions.length;
    const outflows = filteredTransactions.filter(t => Number(t.value) < 0);
    const totalSpent = outflows.reduce((sum, t) => sum + Math.abs(Number(t.value) || 0), 0);
    const averageTransaction = outflows.length > 0 ? totalSpent / outflows.length : 0;
    const dates = filteredTransactions.map(t => new Date(t.date)).sort();
    const dateRange = dates.length > 0
        ? `${formatDate(dates[0])} - ${formatDate(dates[dates.length - 1])}`
        : 'No data';

    document.getElementById('totalTransactions').textContent = totalTransactions.toLocaleString();
    document.getElementById('totalSpent').textContent = `R$ ${totalSpent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    document.getElementById('averageTransaction').textContent = `R$ ${averageTransaction.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    document.getElementById('dateRange').textContent = dateRange;
}

function populateFilters() {
    const categoryFilter = document.getElementById('categoryFilter');
    const personFilter = document.getElementById('personFilter');
    const yearFilter = document.getElementById('yearFilter');
    const monthFilter = document.getElementById('monthFilter');

    const categories = [...new Set(transactions.map(t => t.category))].sort();
    const people = [...new Set(transactions.map(t => t.for))].sort();
    const years = [...new Set(transactions.map(t => new Date(t.date).getFullYear()))].sort((a, b) => b - a);
    const months = [
        { value: '01', text: 'January' }, { value: '02', text: 'February' },
        { value: '03', text: 'March' }, { value: '04', text: 'April' },
        { value: '05', text: 'May' }, { value: '06', text: 'June' },
        { value: '07', text: 'July' }, { value: '08', text: 'August' },
        { value: '09', text: 'September' }, { value: '10', text: 'October' },
        { value: '11', text: 'November' }, { value: '12', text: 'December' }
    ];

    categoryFilter.innerHTML = '<option value="">All Categories</option>';
    personFilter.innerHTML = '<option value="">All People</option>';
    yearFilter.innerHTML = '<option value="">All Years</option>';
    monthFilter.innerHTML = '<option value="">All Months</option>';

    for (const c of categories) {
        const o = document.createElement('option'); o.value = c;
        o.textContent = c.charAt(0).toUpperCase() + c.slice(1);
        categoryFilter.appendChild(o);
    }
    for (const p of people) {
        const o = document.createElement('option'); o.value = p;
        o.textContent = p.charAt(0).toUpperCase() + p.slice(1);
        personFilter.appendChild(o);
    }
    for (const y of years) {
        const o = document.createElement('option'); o.value = y; o.textContent = y;
        yearFilter.appendChild(o);
    }
    for (const m of months) {
        const o = document.createElement('option'); o.value = m.value; o.textContent = m.text;
        monthFilter.appendChild(o);
    }

    // Default to show all years/months (don't preselect current month)
    yearFilter.value = '';
    monthFilter.value = '';
}

function renderCharts() {
    renderCategoryChart();
    renderPersonChart();
    renderMonthlyChart();
}

function renderCategoryChart() {
    const ctx = document.getElementById('categoryChart').getContext('2d');
    if (categoryChart) categoryChart.destroy();

    const totals = {};
    for (const t of filteredTransactions) {
        if (Number(t.value) >= 0) continue;
        totals[t.category] = (totals[t.category] || 0) + Math.abs(Number(t.value) || 0);
    }

    categoryChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: Object.keys(totals),
            datasets: [{
                data: Object.values(totals),
                backgroundColor: [
                    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
                    '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF',
                    '#4BC0C0', '#FF6384', '#36A2EB', '#FFCE56'
                ]
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
}

function renderPersonChart() {
    const ctx = document.getElementById('personChart').getContext('2d');
    if (personChart) personChart.destroy();
    // Net totals per person (credits positive, debits negative)
    const totals = {};
    for (const t of filteredTransactions) {
        const who = t.for || 'unknown';
        totals[who] = (totals[who] || 0) + Number(t.value || 0);
    }

    // Convert to sorted arrays by net descending
    const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const labels = entries.map(e => e[0]);
    const data = entries.map(e => e[1]);
    const bg = entries.map(e => e[1] > 0 ? '#2ecc71' : e[1] < 0 ? '#e74c3c' : '#36A2EB');

    personChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{ label: 'Net (R$)', data, backgroundColor: bg }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false,
                    ticks: {
                        callback: function(value) {
                            try { return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
                            catch { return `R$ ${value}`; }
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const parsed = context.parsed;
                            let v = 0;
                            if (parsed && typeof parsed === 'object' && parsed.y !== undefined) v = parsed.y;
                            else if (typeof parsed === 'number') v = parsed;
                            try { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
                            catch { return `R$ ${v}`; }
                        }
                    }
                }
            }
        }
    });
}

function renderMonthlyChart() {
    const ctx = document.getElementById('monthlyChart').getContext('2d');
    if (monthlyChart) monthlyChart.destroy();

    const monthlyData = {};
    for (const t of filteredTransactions) {
        if (Number(t.value) >= 0) continue;
        const d = new Date(t.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthlyData[key] = (monthlyData[key] || 0) + Math.abs(Number(t.value) || 0);
    }

    const sorted = Object.keys(monthlyData).sort();
    monthlyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: sorted.map(m => { const [y, mo] = m.split('-'); return `${mo}/${y}`; }),
            datasets: [{
                label: 'Monthly Spending (R$)',
                data: sorted.map(m => monthlyData[m]),
                borderColor: '#36A2EB', backgroundColor: 'rgba(54,162,235,0.1)',
                fill: true, tension: 0.4
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
    });
}

function renderTransactionsTable() {
    const tbody = document.getElementById('transactionsTableBody');
    tbody.innerHTML = '';

    for (const t of filteredTransactions) {
        const row = document.createElement('tr');
        const amountClass = t.value < 0 ? 'negative' : 'positive';
        const amountText = t.value < 0
            ? `-R$ ${Math.abs(t.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
            : `R$ ${t.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        const key = `${t.date}|${t.description}|${t.value}`;
        const hasOverride = t.manual_override;
        const overrideClass = hasOverride ? 'manual-override' : '';
        const confidenceLevel = t.confidence_level || 'low';
        const confidenceSource = t.confidence_source || 'Fallback';
        const confidenceLabel = confidenceLevel === 'high' ? 'Alta' : confidenceLevel === 'medium' ? 'Media' : 'Baixa';

        row.innerHTML = `
            <td>${formatDate(new Date(t.date))}</td>
            <td>${t.description}</td>
            <td class="amount ${amountClass}">${amountText}</td>
            <td>
                <span class="confidence-badge confidence-${confidenceLevel}" title="Origem: ${confidenceSource}">
                    ${confidenceLabel}
                </span>
            </td>
            <td class="editable-cell">
                <span class="category category-${t.category} ${overrideClass}"
                      data-key="${key}" data-field="category" data-value="${t.category}">
                    ${t.category}${hasOverride ? ' ✏️' : ''}
                </span>
            </td>
            <td class="editable-cell">
                <span class="for for-${t.for.replace(/\s+/g, '-').toLowerCase()} ${overrideClass}"
                      data-key="${key}" data-field="for" data-value="${t.for}">
                    ${t.for}${hasOverride ? ' ✏️' : ''}
                </span>
            </td>`;
        tbody.appendChild(row);
    }
    setupInlineEditing();
}

function applyFilters() {
    const cf = document.getElementById('categoryFilter').value;
    const pf = document.getElementById('personFilter').value;
    const yf = document.getElementById('yearFilter').value;
    const mf = document.getElementById('monthFilter').value;

    filteredTransactions = transactions.filter(t => {
        if (cf && t.category !== cf) return false;
        if (pf && t.for !== pf) return false;
        if (yf || mf) {
            const d = new Date(t.date);
            if (yf && d.getFullYear().toString() !== yf) return false;
            if (mf && String(d.getMonth() + 1).padStart(2, '0') !== mf) return false;
        }
        return true;
    });

    if (currentSort.column) {
        sortTable(currentSort.column, true);
        renderStats();
        renderFinancialAlerts();
        renderCharts();
    } else {
        renderStats();
        renderFinancialAlerts();
        renderCharts();
        renderTransactionsTable();
    }

    scheduleInsightsRefresh();
}

function clearFilters() {
    document.getElementById('categoryFilter').value = '';
    document.getElementById('personFilter').value = '';
    document.getElementById('yearFilter').value = '';
    document.getElementById('monthFilter').value = '';
    currentSort = { column: null, direction: 'asc' };
    updateSortIndicators();
    filteredTransactions = [...transactions];
    renderStats();
    renderFinancialAlerts();
    renderCharts();
    renderTransactionsTable();
    scheduleInsightsRefresh();
}

function sortTable(column, preserveDirection = false) {
    if (currentSort.column === column && !preserveDirection) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.column = column;
        if (!preserveDirection) currentSort.direction = 'asc';
    }

    filteredTransactions.sort((a, b) => {
        let aV, bV;
        switch (column) {
            case 'date': aV = new Date(a.date); bV = new Date(b.date); break;
            case 'description': aV = a.description.toLowerCase(); bV = b.description.toLowerCase(); break;
            case 'value': aV = Math.abs(a.value); bV = Math.abs(b.value); break;
            case 'confidence': {
                const score = { high: 3, medium: 2, low: 1 };
                aV = score[a.confidence_level || 'low'];
                bV = score[b.confidence_level || 'low'];
                break;
            }
            case 'category': aV = a.category.toLowerCase(); bV = b.category.toLowerCase(); break;
            case 'for': aV = a.for.toLowerCase(); bV = b.for.toLowerCase(); break;
            default: return 0;
        }
        if (aV < bV) return currentSort.direction === 'asc' ? -1 : 1;
        if (aV > bV) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
    });

    updateSortIndicators();
    renderTransactionsTable();
}

function updateSortIndicators() {
    document.querySelectorAll('.sortable').forEach(h => {
        h.classList.remove('sorted-asc', 'sorted-desc');
        if (h.dataset.column === currentSort.column) h.classList.add(`sorted-${currentSort.direction}`);
    });
}

// Inline editing
function setupInlineEditing() {
    document.querySelectorAll('.editable-cell span[data-key]').forEach(el => {
        el.addEventListener('click', e => { e.preventDefault(); startInlineEdit(el); });
    });
}

function startInlineEdit(element) {
    const key = element.dataset.key;
    const field = element.dataset.field;
    const currentValue = element.dataset.value;

    let options = field === 'category'
        ? [...new Set(transactions.map(t => t.category))].sort()
        : [...new Set(transactions.map(t => t.for))].sort();

    const dropdown = document.createElement('select');
    dropdown.className = 'inline-edit-dropdown';

    const co = document.createElement('option'); co.value = currentValue; co.textContent = currentValue;
    dropdown.appendChild(co);
    options.filter(o => o !== currentValue).forEach(o => {
        const oe = document.createElement('option'); oe.value = o; oe.textContent = o;
        dropdown.appendChild(oe);
    });

    element.style.display = 'none';
    element.parentNode.appendChild(dropdown);
    dropdown.focus();

    dropdown.addEventListener('change', () => {
        if (dropdown.value !== currentValue) saveOverride(key, field, dropdown.value);
        cancelInlineEdit(element, dropdown);
    });
    dropdown.addEventListener('keydown', e => { if (e.key === 'Escape') cancelInlineEdit(element, dropdown); });
    setTimeout(() => {
        const handler = e => { if (!dropdown.contains(e.target)) { cancelInlineEdit(element, dropdown); document.removeEventListener('click', handler); } };
        document.addEventListener('click', handler);
    }, 100);
}

function cancelInlineEdit(element, dropdown) {
    element.style.display = '';
    dropdown.remove();
}

async function saveOverride(key, field, newValue) {
    try {
        const t = filteredTransactions.find(t => `${t.date}|${t.description}|${t.value}` === key);
        if (t) {
            t[field] = newValue;
            t.manual_override = true;
            t.confidence_level = 'high';
            t.confidence_source = 'IA/Manual';
            t.classification_source = 'manual_override';
        }
        const mt = transactions.find(t => `${t.date}|${t.description}|${t.value}` === key);
        if (mt) {
            mt[field] = newValue;
            mt.manual_override = true;
            mt.confidence_level = 'high';
            mt.confidence_source = 'IA/Manual';
            mt.classification_source = 'manual_override';
        }

        await saveOverridesToFile(key, field, newValue);
        // re-apply filters so any active category/person/year/month selection
        // is taken into account – this also rebuilds charts and stats
        applyFilters();
    } catch (error) {
        console.error('Error saving override:', error);
        alert('Failed to save override.');
    }
}

async function saveOverridesToFile(key, field, newValue) {
    try {
        // Sync with server first
        const response = await fetch('/api/save-override', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, field, value: newValue })
        });
        
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
        
        // Also keep localStorage in sync as fallback
        let overrides = { description: "Manual overrides", overrides: {}, version: "1.0" };
        try {
            const stored = localStorage.getItem('finance_overrides');
            if (stored) overrides = JSON.parse(stored);
        } catch {}
        
        if (!overrides.overrides[key]) overrides.overrides[key] = {};
        overrides.overrides[key][field] = newValue;
        localStorage.setItem('finance_overrides', JSON.stringify(overrides));
        
        showToast(`✅ Saved: ${field} = ${newValue}`, 'success');
    } catch (error) {
        console.error('Error saving override to server:', error);
        alert('Failed to save override to server.');
    }
}

function exportOverrides() {
    try {
        const stored = localStorage.getItem('finance_overrides');
        if (!stored) { alert('No overrides to export.'); return; }
        const overrides = JSON.parse(stored);
        const count = Object.keys(overrides.overrides || {}).length;
        if (count === 0) { alert('No overrides to export.'); return; }

        const blob = new Blob([JSON.stringify(overrides, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'overrides.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`📁 Exported ${count} overrides`, 'info');
    } catch (error) {
        console.error('Error exporting:', error);
        alert('Failed to export overrides.');
    }
}

async function exportFiles() {
    try {
        const response = await fetch('/api/export/files', { method: 'POST' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `finance-export-${new Date().toISOString().slice(0,10)}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('📥 Files exported successfully!', 'success');
    } catch (error) {
        console.error('Error exporting files:', error);
        showToast('❌ Failed to export files', 'error');
    }
}

// Utilities
function formatDate(date) { return date.toLocaleDateString('pt-BR'); }

function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    const colors = { success: '#28a745', error: '#dc3545', info: '#007bff', warn: '#ffc107' };
    toast.style.cssText = `
        position:fixed; top:20px; right:20px; background:${colors[type] || colors.info};
        color:white; padding:12px 20px; border-radius:8px; z-index:10000;
        font-size:14px; box-shadow:0 4px 12px rgba(0,0,0,0.2); max-width:400px;
        animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => document.body.removeChild(toast), 300); }, 4000);
}

function showError(message) {
    const container = document.querySelector('.container');
    const div = document.createElement('div');
    div.className = 'error';
    div.textContent = message;
    container.insertBefore(div, container.firstChild);
}