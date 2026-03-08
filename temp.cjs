const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data/merged.json','utf8'));
const normalize = (desc) => {
  if(!desc) return '';
  let d = desc.toString().toLowerCase();
  d = d.replace(/[\u00A0\u202F\u2007]/g,' ');
  d = d.replace(/[\u2012-\u2015]/g,'-');
  d = d.replace(/\s+/g,' ').trim();
  d = d.replace(/ - bco .*$/i,'');
  d = d.replace(/ag[eê]ncia:.*$/i,'');
  d = d.replace(/conta:.*$/i,'');
  return d.trim();
};

const lucEntries = data.filter(t => t.description && t.description.includes('LUCAS PEREIRA'));
lucEntries.forEach((t,i) => {
  console.log(i, t.date, '|', JSON.stringify(t.description));
  console.log('norm', normalize(t.description));
});
