import { Router, Request, Response } from 'express';
import { addSSEClient } from '../services/notification.service';
import { getBusinessContext } from '../database/businessContext';

const router = Router();

router.get('/stream', (req: Request, res: Response) => {
  // A rota passa pelo authMiddleware (que aceita ?token= porque o EventSource
  // não envia cabeçalhos), então o estabelecimento já está no contexto.
  const { businessId } = getBusinessContext()!;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  addSSEClient(res, businessId);
});

export default router;
