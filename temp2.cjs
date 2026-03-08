const fs=require('fs');
const data=JSON.parse(fs.readFileSync('data/merged.json','utf8'));
const matches1 = data.filter(t=>t.description && t.description.toLowerCase().includes('armazem urbano'));
console.log('armazem urbano entries:' , matches1);
const matches2 = data.filter(t=>t.description && t.description.toLowerCase().includes('drive digital'));
console.log('drive digital entries:' , matches2);
