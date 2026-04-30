import b from '@babel/parser';
import fs from 'fs';
for (const f of ['src/pages/CostiFissiPage.jsx','src/App.jsx','src/components/Layout.jsx','src/api/supabase-client.js','src/api/client.js']) {
  try { b.parse(fs.readFileSync(f,'utf8'), { sourceType:'module', plugins:['jsx'] }); console.log('OK',f); }
  catch(e){ console.log('ERR',f,e.message); }
}
