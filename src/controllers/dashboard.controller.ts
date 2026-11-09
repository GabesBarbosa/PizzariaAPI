import { Request, Response, NextFunction } from 'express';
import * as dashboardService from '../services/dashboard.service';

const VALID_PERIODS = ['day', 'week', 'month'];

function parsePeriod(req: Request): string {
  const p = (req.query.period as string || 'week').toLowerCase();
  return VALID_PERIODS.includes(p) ? p : 'week';
}

export const getStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await dashboardService.getDashboardStats(parsePeriod(req));
    res.json(stats);
  } catch (err) {
    next(err);
  }
};

export const getAnalytics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const analytics = await dashboardService.getAnalytics(parsePeriod(req));
    res.json(analytics);
  } catch (err) {
    next(err);
  }
};

export const getCustomerAnalytics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await dashboardService.getCustomerAnalytics(parsePeriod(req));
    res.json(data);
  } catch (err) {
    next(err);
  }
};

/* ─── Exportação de relatórios (RF22 / RF25) ─── */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

/**
 * Lê ?from=AAAA-MM-DD&to=AAAA-MM-DD (dias inteiros no horário de Brasília) e devolve
 * o intervalo em UTC, que é como o banco grava createdAt. O Brasil não tem horário
 * de verão desde 2019, então o deslocamento é fixo em -03:00.
 */
function parseRange(req: Request): { from: string; to: string; fromUtc: Date; toUtc: Date } | string {
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return 'Informe from e to no formato AAAA-MM-DD.';

  const fromUtc = new Date(`${from}T00:00:00-03:00`);
  const toUtc = new Date(`${to}T00:00:00-03:00`);
  if (isNaN(fromUtc.getTime()) || isNaN(toUtc.getTime())) return 'Data inválida.';
  if (toUtc < fromUtc) return 'A data final deve ser igual ou posterior à inicial.';
  toUtc.setUTCDate(toUtc.getUTCDate() + 1); // inclui o dia final inteiro
  if ((toUtc.getTime() - fromUtc.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
    return `O período máximo é de ${MAX_RANGE_DAYS} dias.`;
  }
  return { from, to, fromUtc, toUtc };
}

const STATUS_PT: Record<string, string> = {
  RECEIVED: 'Recebido', PREPARING: 'Em preparo', OUT_FOR_DELIVERY: 'Em entrega',
  DELIVERED: 'Finalizado', CANCELLED: 'Cancelado',
};
const CHANNEL_PT: Record<string, string> = {
  balcao: 'Balcão', delivery: 'Delivery', whatsapp: 'WhatsApp', web: 'Cardápio online',
  mesa: 'Mesa', ifood: 'iFood', telefone: 'Telefone', site: 'Site/App',
};

/** 12.5 → "12,50" (vírgula decimal, como o Excel em português espera). */
const fmtBR = (v: any) => (Number(v) || 0).toFixed(2).replace('.', ',');

const fmtDate = (d: Date) =>
  new Date(d).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).replace(',', '');

/** Coloca o campo entre aspas se tiver ; aspas ou quebra de linha. */
function csvField(v: any): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const exportOrdersCsv = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const range = parseRange(req);
    if (typeof range === 'string') return res.status(400).json({ message: range });

    const rows = await dashboardService.getOrdersForExport(range.fromUtc, range.toUtc);
    const header = 'Pedido;Data;Cliente;Canal;Status;Pagamento;Frete;Total';
    const lines = rows.map((r: any) => [
      r.id,
      fmtDate(r.createdAt),
      r.cliente ?? '',
      CHANNEL_PT[r.channel] ?? r.channel ?? '',
      STATUS_PT[r.status] ?? r.status,
      r.paymentMethod ?? '',
      fmtBR(r.deliveryFee),
      fmtBR(r.total),
    ].map(csvField).join(';'));

    // ';' como separador e o BOM (﻿) fazem o Excel em português abrir com acentos e colunas certas.
    const csv = '﻿' + [header, ...lines].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pedidos_${range.from}_${range.to}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
};

export const exportSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const range = parseRange(req);
    if (typeof range === 'string') return res.status(400).json({ message: range });
    const summary = await dashboardService.getExportSummary(range.fromUtc, range.toUtc);
    res.json({ from: range.from, to: range.to, ...summary });
  } catch (err) {
    next(err);
  }
};
