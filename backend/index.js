// index.js
const express = require('express');
const cors = require('cors');
const pingRoute = require('./routes/ping');
const generateRoute = require('./routes/generate');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use('/api/ping', pingRoute);
app.use('/api/generate', generateRoute);

const transcribeRoute = require('./routes/transcribe');
app.use('/api/transcribe', transcribeRoute);


app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});
