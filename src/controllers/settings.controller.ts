import { Request, Response, NextFunction } from 'express';
import {
  getDeliveryFee,
  setSetting,
  getChatbotMode,
  getChatbotEnabled,
  setChatbotEnabled,
  getChatbotConfig,
  getBusinessType,
  setBusinessType,
  setCrustOptions,
  setSizeOptions,
  setPaymentMethods,
  type CrustOption,
  type SizeOption,
  type PaymentOption,
  type BusinessType,
} from '../repositories/settings.repository';

export const getSettings = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [deliveryFee, chatbotMode, chatbotEnabled, businessType, chatbotConfig] = await Promise.all([
      getDeliveryFee(),
      getChatbotMode(),
      getChatbotEnabled(),
      getBusinessType(),
      getChatbotConfig(),
    ]);
    res.json({ deliveryFee, chatbotMode, chatbotEnabled, businessType, ...chatbotConfig });
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

export const updateCrustOptions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { crustOptions } = req.body;
    if (!Array.isArray(crustOptions)) {
      res.status(400).json({ message: 'crustOptions deve ser um array de { label, price }.' });
      return;
    }
    for (const opt of crustOptions) {
      if (!opt.label || typeof opt.price !== 'number' || opt.price < 0) {
        res.status(400).json({ message: 'Cada opção de borda precisa de label (string) e price (número >= 0).' });
        return;
      }
    }
    await setCrustOptions(crustOptions as CrustOption[]);
    res.json({ crustOptions });
  } catch (err) {
    next(err);
  }
};

export const updateSizeOptions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sizeOptions } = req.body;
    if (!sizeOptions || typeof sizeOptions !== 'object' || Array.isArray(sizeOptions)) {
      res.status(400).json({ message: 'sizeOptions deve ser um objeto { key: { label, maxFlavors, multiplier } }.' });
      return;
    }
    for (const [key, opt] of Object.entries(sizeOptions) as [string, any][]) {
      if (!opt.label || typeof opt.maxFlavors !== 'number' || typeof opt.multiplier !== 'number') {
        res.status(400).json({ message: `Tamanho "${key}" precisa de label, maxFlavors e multiplier.` });
        return;
      }
    }
    await setSizeOptions(sizeOptions as Record<string, SizeOption>);
    res.json({ sizeOptions });
  } catch (err) {
    next(err);
  }
};

export const updateBusinessType = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { businessType } = req.body;
    if (businessType !== 'pizzaria' && businessType !== 'hamburgueria' && businessType !== 'generic') {
      res.status(400).json({ message: 'Tipo inválido. Use "pizzaria", "hamburgueria" ou "generic".' });
      return;
    }
    await setBusinessType(businessType as BusinessType);
    res.json({ businessType });
  } catch (err) {
    next(err);
  }
};

export const updateChatbotEnabled = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ message: 'enabled deve ser boolean.' });
      return;
    }
    await setChatbotEnabled(enabled);
    res.json({ chatbotEnabled: enabled });
  } catch (err) {
    next(err);
  }
};

export const updatePaymentMethods = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { paymentMethods } = req.body;
    if (!Array.isArray(paymentMethods)) {
      res.status(400).json({ message: 'paymentMethods deve ser um array de { key, label }.' });
      return;
    }
    for (const pm of paymentMethods) {
      if (!pm.key || !pm.label) {
        res.status(400).json({ message: 'Cada método de pagamento precisa de key e label.' });
        return;
      }
    }
    await setPaymentMethods(paymentMethods as PaymentOption[]);
    res.json({ paymentMethods });
  } catch (err) {
    next(err);
  }
};
