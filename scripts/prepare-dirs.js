// Garante que as pastas data/ e dashboard/data/ existem
import fs from 'node:fs/promises';
import path from 'node:path';

const dirs = [
  path.join(process.cwd(), 'data'),
  path.join(process.cwd(), 'dashboard', 'data')
];

for (const dir of dirs) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {
    // Ignora se já existe
  }
}
