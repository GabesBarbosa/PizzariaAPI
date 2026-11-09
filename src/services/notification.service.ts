import { Response } from 'express';
import logger from '../utils/logger';

interface SSEClient {
  id: string;
  res: Response;
  heartbeat: NodeJS.Timeout;
  /** Estabelecimento dono do painel conectado (RN08: cada um só vê os próprios avisos). */
  businessId: string;
}

const clients: SSEClient[] = [];
let clientIdCounter = 0;

// Heartbeat a cada 30 segundos para manter conexão viva
const HEARTBEAT_INTERVAL = 30000;

export function addSSEClient(res: Response, businessId: string): string {
  const id = String(++clientIdCounter);

  // Heartbeat para manter a conexão viva
  const heartbeat = setInterval(() => {
    try {
      res.write(':heartbeat\n\n');
    } catch {
      // Conexão fechada, será limpa no 'close'
    }
  }, HEARTBEAT_INTERVAL);

  clients.push({ id, res, heartbeat, businessId });

  res.on('close', () => {
    const idx = clients.findIndex(c => c.id === id);
    if (idx !== -1) {
      clearInterval(clients[idx].heartbeat);
      clients.splice(idx, 1);
    }
    logger.info(`[SSE] Client ${id} desconectado (${clients.length} restantes)`);
  });

  logger.info(`[SSE] Client ${id} conectado — business ${businessId} (${clients.length} total)`);
  return id;
}

/** Envia o evento só para os painéis do estabelecimento informado. */
export function broadcast(event: string, data: any, businessId: string): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (client.businessId !== businessId) continue;
    try {
      client.res.write(payload);
    } catch {
      /* client disconnected, will be cleaned up on 'close' */
    }
  }
}
