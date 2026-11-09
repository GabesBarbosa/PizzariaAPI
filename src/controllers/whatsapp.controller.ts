import { Request, Response, NextFunction } from 'express';
import * as whatsappService from '../services/whatsapp.service';
import * as handoffService from '../services/handoff.service';
import { getAllCustomers } from '../repositories/customer.repository';
import { getBusinessContext } from '../database/businessContext';

export const restartWhatsApp = async (_req: Request, res: Response) => {
  const { businessId } = getBusinessContext()!;
  await whatsappService.restartWhatsApp(businessId);
  res.json({ message: 'WhatsApp reiniciando... aguarde o novo QR Code.' });
};

export const getStatus = async (_req: Request, res: Response) => {
  const { businessId } = getBusinessContext()!;
  const status = await whatsappService.getStatus(businessId);
  res.json(status);
};

export const sendMessage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { businessId } = getBusinessContext()!;
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'phone e message são obrigatórios' });
    }
    const result = await whatsappService.sendTextMessage(businessId, phone, message);
    res.json({ success: true, result });
  } catch (err: any) {
    if (err.message?.includes('não está conectado')) {
      return res.status(503).json({ error: err.message });
    }
    next(err);
  }
};

export const sendBulk = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { businessId } = getBusinessContext()!;
    const { phones, message } = req.body;
    if (!phones?.length || !message) {
      return res.status(400).json({ error: 'phones (array) e message são obrigatórios' });
    }
    const result = await whatsappService.sendBulkMessages(businessId, phones, message);
    res.json(result);
  } catch (err: any) {
    if (err.message?.includes('não está conectado')) {
      return res.status(503).json({ error: err.message });
    }
    next(err);
  }
};

export const sendToAllCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { businessId } = getBusinessContext()!;
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'message é obrigatório' });
    }
    const customers = await getAllCustomers();
    const phones = customers.map((c: any) => c.phone).filter(Boolean);
    if (phones.length === 0) {
      return res.status(400).json({ error: 'Nenhum cliente com telefone cadastrado' });
    }
    const result = await whatsappService.sendBulkMessages(businessId, phones, message);
    res.json({ totalCustomers: phones.length, ...result });
  } catch (err: any) {
    if (err.message?.includes('não está conectado')) {
      return res.status(503).json({ error: err.message });
    }
    next(err);
  }
};

/* ─── Atendimento humano (RF30 / RN10) ─── */

export const listHandoffs = async (_req: Request, res: Response) => {
  const { businessId } = getBusinessContext()!;
  res.json({ handoffs: handoffService.listHandoffs(businessId) });
};

export const endHandoff = async (req: Request, res: Response) => {
  const { businessId } = getBusinessContext()!;
  const ended = handoffService.endHandoff(businessId, req.params.phone);
  if (!ended) return res.status(404).json({ message: 'Nenhum atendimento ativo para esse telefone.' });
  res.json({ message: 'Atendimento encerrado. O chatbot voltou a responder essa conversa.' });
};
