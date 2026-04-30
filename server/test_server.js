require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors()); app.use(express.json());
['modules','employees','kpi','venduto','chiusure','chat','data','fornitori','analytics'].forEach(r => {
  app.use('/api/' + r, require('./routes/' + r));
});
app.listen(3096, () => console.log('Ready on 3096'));
setTimeout(() => process.exit(), 30000);
