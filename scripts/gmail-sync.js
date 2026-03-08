// Gmail Sync - Automatically fetches Nubank CSV/OFX attachments from Gmail
// Can be run standalone: node scripts/gmail-sync.js
// Or called from server.js as auto-sync

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CREDENTIALS_PATH = path.join(ROOT, 'credentials.json');
const TOKEN_PATH = path.join(ROOT, 'gmail-token.json');
const DATA_DIR = path.join(ROOT, 'data');
const SYNC_STATE_PATH = path.join(ROOT, 'data', '.gmail-sync-state.json');

// Nubank email patterns
const NUBANK_SENDERS = [
    'from:nubank',
    'from:nu.com.br',
    'from:nubank.com.br'
];

const VALID_EXTENSIONS = ['.csv', '.ofx', '.OFX', '.CSV'];

/**
 * Get authenticated Gmail client
 */
async function getGmailClient() {
    let credentials;
    try {
        credentials = JSON.parse(await fs.readFile(CREDENTIALS_PATH, 'utf8'));
    } catch {
        throw new Error('credentials.json não encontrado. Rode: node scripts/gmail-auth.js');
    }

    let token;
    try {
        token = JSON.parse(await fs.readFile(TOKEN_PATH, 'utf8'));
    } catch {
        throw new Error('gmail-token.json não encontrado. Rode: node scripts/gmail-auth.js');
    }

    const { client_id, client_secret } = credentials.installed || credentials.web || {};
    const oauth2Client = new google.auth.OAuth2(
        client_id, client_secret, 'http://localhost:3333/oauth2callback'
    );
    oauth2Client.setCredentials(token);

    // Auto-refresh token
    oauth2Client.on('tokens', async (tokens) => {
        if (tokens.refresh_token) {
            token.refresh_token = tokens.refresh_token;
        }
        token.access_token = tokens.access_token;
        token.expiry_date = tokens.expiry_date;
        await fs.writeFile(TOKEN_PATH, JSON.stringify(token, null, 2));
    });

    return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * Load sync state (which emails we've already processed)
 */
async function loadSyncState() {
    try {
        return JSON.parse(await fs.readFile(SYNC_STATE_PATH, 'utf8'));
    } catch {
        return { processedMessageIds: [], lastSync: null };
    }
}

async function saveSyncState(state) {
    state.lastSync = new Date().toISOString();
    await fs.writeFile(SYNC_STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Search Gmail for Nubank emails with attachments
 */
async function searchNubankEmails(gmail, afterDate) {
    const query = `(${NUBANK_SENDERS.join(' OR ')}) has:attachment${afterDate ? ` after:${afterDate}` : ''}`;
    
    console.log(`🔍 Buscando emails: ${query}`);

    const messages = [];
    let pageToken = null;

    do {
        const res = await gmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults: 20,
            pageToken
        });

        if (res.data.messages) {
            messages.push(...res.data.messages);
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);

    console.log(`📧 Encontrados ${messages.length} emails do Nubank com anexos`);
    return messages;
}

/**
 * Download attachments from a specific email
 */
async function downloadAttachments(gmail, messageId) {
    const msg = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
    });

    const attachments = [];
    const parts = msg.data.payload?.parts || [];

    for (const part of parts) {
        const filename = part.filename || '';
        const ext = path.extname(filename).toLowerCase();

        if (!VALID_EXTENSIONS.includes(ext) && !VALID_EXTENSIONS.includes(path.extname(filename))) {
            continue;
        }

        if (!part.body?.attachmentId) continue;

        const attachment = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: messageId,
            id: part.body.attachmentId
        });

        if (attachment.data?.data) {
            const buffer = Buffer.from(attachment.data.data, 'base64');
            attachments.push({
                filename,
                data: buffer,
                mimeType: part.mimeType
            });
        }
    }

    // Also check nested parts (multipart emails)
    for (const part of parts) {
        if (part.parts) {
            for (const subpart of part.parts) {
                const filename = subpart.filename || '';
                const ext = path.extname(filename).toLowerCase();
                if (!VALID_EXTENSIONS.includes(ext) && !VALID_EXTENSIONS.includes(path.extname(filename))) continue;
                if (!subpart.body?.attachmentId) continue;

                const attachment = await gmail.users.messages.attachments.get({
                    userId: 'me',
                    messageId: messageId,
                    id: subpart.body.attachmentId
                });

                if (attachment.data?.data) {
                    const buffer = Buffer.from(attachment.data.data, 'base64');
                    attachments.push({
                        filename,
                        data: buffer,
                        mimeType: subpart.mimeType
                    });
                }
            }
        }
    }

    return attachments;
}

/**
 * Main sync function
 */
export async function syncFromGmail() {
    console.log('📬 Iniciando sync do Gmail...');

    const gmail = await getGmailClient();
    const state = await loadSyncState();

    // Search for emails from last 90 days if first sync, otherwise since last sync
    let afterDate;
    if (state.lastSync) {
        const d = new Date(state.lastSync);
        d.setDate(d.getDate() - 1); // 1 day overlap for safety
        afterDate = d.toISOString().split('T')[0].replace(/-/g, '/');
    } else {
        const d = new Date();
        d.setDate(d.getDate() - 90);
        afterDate = d.toISOString().split('T')[0].replace(/-/g, '/');
    }

    const messages = await searchNubankEmails(gmail, afterDate);
    let newFiles = 0;

    for (const msg of messages) {
        if (state.processedMessageIds.includes(msg.id)) {
            continue;
        }

        const attachments = await downloadAttachments(gmail, msg.id);

        for (const att of attachments) {
            // Generate unique filename to avoid overwriting
            const safeName = att.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
            const destPath = path.join(DATA_DIR, safeName);

            // Check if file already exists with same content
            try {
                const existing = await fs.readFile(destPath);
                if (existing.equals(att.data)) {
                    console.log(`  ⏭️ ${safeName} (já existe, mesmo conteúdo)`);
                    continue;
                }
                // Different content, add timestamp
                const ext = path.extname(safeName);
                const base = path.basename(safeName, ext);
                const newName = `${base}_${Date.now()}${ext}`;
                await fs.writeFile(path.join(DATA_DIR, newName), att.data);
                console.log(`  📥 ${newName} (novo, renomeado)`);
                newFiles++;
            } catch {
                // File doesn't exist, save it
                await fs.writeFile(destPath, att.data);
                console.log(`  📥 ${safeName}`);
                newFiles++;
            }
        }

        state.processedMessageIds.push(msg.id);

        // Keep only last 500 message IDs
        if (state.processedMessageIds.length > 500) {
            state.processedMessageIds = state.processedMessageIds.slice(-500);
        }
    }

    await saveSyncState(state);

    console.log(`✅ Sync concluído: ${newFiles} novos arquivos baixados`);
    return { newFiles, totalEmails: messages.length };
}

// Run standalone
if (process.argv[1] && process.argv[1].includes('gmail-sync')) {
    syncFromGmail()
        .then(result => {
            console.log(`\n📊 Resultado: ${result.newFiles} novos, ${result.totalEmails} emails verificados`);
        })
        .catch(err => {
            console.error('❌ Erro:', err.message);
            process.exit(1);
        });
}