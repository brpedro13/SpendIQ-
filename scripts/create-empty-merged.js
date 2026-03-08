// Cria um merged.json vazio se não existir
import fs from 'node:fs/promises';
import path from 'node:path';

const mergedPath = path.join(process.cwd(), 'data', 'merged.json');

async function ensureMergedJson() {
  try {
    await fs.access(mergedPath);
    // Já existe, não faz nada
  } catch {
    // Não existe, cria vazio
    await fs.mkdir(path.dirname(mergedPath), { recursive: true });
    await fs.writeFile(mergedPath, '[]', 'utf8');
    console.log('✅ merged.json vazio criado');
  }
}

ensureMergedJson();
