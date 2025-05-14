// routes/ping.ts
import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.send({ message: 'pong' });
});

export default router;
