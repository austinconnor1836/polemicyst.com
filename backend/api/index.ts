import express, { Request, Response } from 'express';
import cors from 'cors';
import pingRoute from './routes/ping';
import generateRoute from './routes/generate';
import clipGenerationRoute from './routes/clip-generation';
import clipCandidatesRoute from './routes/clip-candidates';
import clipJobsRoute from './routes/clip-jobs';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/ping', pingRoute);
app.use('/api/generate', generateRoute);
app.use('/api/clip-generation', clipGenerationRoute);
app.use('/api/clip-candidates', clipCandidatesRoute);
app.use('/api/clip-jobs', clipJobsRoute);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});
