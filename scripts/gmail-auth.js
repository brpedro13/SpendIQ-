// Gmail Auth - Run this once to authorize your Google account
// Usage: node scripts/gmail-auth.js

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import http from 'node:http';
import { URL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CREDENTIALS_PATH = path.join(ROOT, 'credentials.json');
const TOKEN_PATH = path.join(ROOT, 'gmail-token.json');
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

async function authorize() {
    // Load credentials
    let credentials;
    try {
        const content = await fs.readFile(CREDENTIALS_PATH, 'utf8');
        credentials = JSON.parse(content);
    } catch {
        console.error('❌ Arquivo credentials.json não encontrado na raiz do projeto.');
        console.error('   Baixe em: Google Cloud Console → APIs & Services → Credentials');
        process.exit(1);
    }

    const { client_id, client_secret } = credentials.installed || credentials.web || {};
    if (!client_id || !client_secret) {
        console.error('❌ credentials.json inválido. Use tipo "Desktop App".');
        process.exit(1);
    }

    const redirect_uri = 'http://localhost:3333/oauth2callback';
    const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

    // Check if already authorized
    try {
        const token = JSON.parse(await fs.readFile(TOKEN_PATH, 'utf8'));
        oauth2Client.setCredentials(token);
        console.log('✅ Já autorizado! Token existente em gmail-token.json');
        
        // Test the connection
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const profile = await gmail.users.getProfile({ userId: 'me' });
        console.log(`📧 Conectado como: ${profile.data.emailAddress}`);
        return;
    } catch {
        // Need to authorize
    }

    // Generate auth URL
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });

    console.log('🔐 Autorização necessária.');
    console.log('');
    console.log('Abrindo navegador... Se não abrir, copie e cole este link:');
    console.log('');
    console.log(authUrl);
    console.log('');

    // Open browser
    const { exec } = await import('node:child_process');
    const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${cmd} "${authUrl}"`);

    // Start local server to receive callback
    const code = await new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            const url = new URL(req.url, 'http://localhost:3333');
            if (url.pathname === '/oauth2callback') {
                const code = url.searchParams.get('code');
                if (code) {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end('<h1>✅ Autorizado!</h1><p>Pode fechar esta janela.</p>');
                    server.close();
                    resolve(code);
                } else {
                    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end('<h1>❌ Erro na autorização</h1>');
                    server.close();
                    reject(new Error('No code received'));
                }
            }
        });
        server.listen(3333, () => {
            console.log('⏳ Aguardando autorização no navegador...');
        });
        setTimeout(() => { server.close(); reject(new Error('Timeout')); }, 120000);
    });

    // Exchange code for token
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Save token
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log('');
    console.log('✅ Autorização concluída! Token salvo em gmail-token.json');

    // Test
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log(`📧 Conectado como: ${profile.data.emailAddress}`);
}

authorize().catch(err => {
    console.error('❌ Erro:', err.message);
    process.exit(1);
});