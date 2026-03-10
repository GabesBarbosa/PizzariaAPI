import { Router, Request, Response } from 'express';
import { addSSEClient } from '../services/notification.service';

const router = Router();

router.get('/stream', (req: Request, res: Response) => {
  // Auth already handled by authMiddleware.
  // For SSE, the frontend passes token as query param;
  // the auth middleware was adapted to also accept ?token= (see below).
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  addSSEClient(res);
});

export default router;
