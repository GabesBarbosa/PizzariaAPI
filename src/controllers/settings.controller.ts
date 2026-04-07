import { Request, Response, NextFunction } from 'express';
import { getDeliveryFee, setSetting, getChatbotMode } from '../repositories/settings.repository';

export const getSettings = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [deliveryFee, chatbotMode] = await Promise.all([getDeliveryFee(), getChatbotMode()]);
    res.json({ deliveryFee, chatbotMode });
  } catch (err) {
    next(err);
  }
};

export const updateChatbotMode = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mode } = req.body;
    if (mode !== 'ai' && mode !== 'triggers') {
      res.status(400).json({ message: 'Modo inválido. Use "ai" ou "triggers".' });
      return;
    }
    await setSetting('chatbotMode', mode);
    res.json({ chatbotMode: mode });
  } catch (err) {
    next(err);
  }
};

export const updateDeliveryFee = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fee = parseFloat(req.body.deliveryFee);
    if (isNaN(fee) || fee < 0) {
      res.status(400).json({ message: 'Valor inválido para taxa de entrega.' });
      return;
    }
    await setSetting('deliveryFee', fee.toFixed(2));
    res.json({ deliveryFee: fee });
  } catch (err) {
    next(err);
  }
};
