import b from '@babel/parser';
import fs from 'fs';
for (const f of ['src/pages/FornitoriPage.jsx','src/api/supabase-client.js','src/pages/VendutoPage.jsx']) {
  const src = fs.readFileSync(f,'utf8');
  try { b.parse(src, { sourceType:'module', plugins:['jsx'] }); console.log('OK',f); }
  catch(e){ console.log('ERR',f, e.message); }
}
