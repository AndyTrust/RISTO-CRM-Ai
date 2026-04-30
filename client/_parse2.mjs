import b from '@babel/parser';
import fs from 'fs';
const src = fs.readFileSync('src/pages/VendutoPage.jsx','utf8');
try { b.parse(src, { sourceType:'module', plugins:['jsx'] }); console.log('OK VendutoPage'); }
catch(e){ console.log('ERR', e.message); }
