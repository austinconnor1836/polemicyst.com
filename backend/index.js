// index.js
const express = require('express');
const cors = require('cors');
const pingRoute = require('./routes/ping');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use('/api/ping', pingRoute);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});
