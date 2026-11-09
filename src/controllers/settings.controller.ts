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
  getBusinessOrigin,
  setBusinessOrigin,
  getDeliveryZones,
  setDeliveryZones,
  getTableCount,
  setTableCount,
  getOpeningHours,
  setOpeningHours,
  type CrustOption,
  type SizeOption,
  type PaymentOption,
  type BusinessType,
  type BusinessOrigin,
  type DeliveryZone,
} from '../repositories/settings.repository';
import { geocodeAddress, lookupCep } from '../services/geocoding.service';
import { validarOpeningHours, normalizarOpeningHours, estaAberto } from '../utils/opening-hours';

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

/* ─── Origem do estabelecimento (endereço + geocoding) ─── */

export const getOrigin = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const origin = await getBusinessOrigin();
    res.json({ origin });
  } catch (err) {
    next(err);
  }
};

export const updateOrigin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cep, street, number, complement, neighborhood, city, uf, latitude, longitude } = req.body ?? {};
    if (!cep || !number) {
      res.status(400).json({ message: 'CEP e número são obrigatórios.' });
      return;
    }

    let resolvedStreet = street;
    let resolvedNeighborhood = neighborhood;
    let resolvedCity = city;
    let resolvedUf = uf;

    if (!resolvedStreet || !resolvedCity || !resolvedUf) {
      const cepInfo = await lookupCep(cep);
      if (!cepInfo) {
        res.status(400).json({ message: 'CEP não localizado.' });
        return;
      }
      resolvedStreet       ||= cepInfo.street;
      resolvedNeighborhood ||= cepInfo.neighborhood;
      resolvedCity         ||= cepInfo.city;
      resolvedUf           ||= cepInfo.uf;
    }

    let lat = typeof latitude === 'number' ? latitude : null;
    let lng = typeof longitude === 'number' ? longitude : null;

    if (lat === null || lng === null) {
      const geo = await geocodeAddress({
        cep,
        street: resolvedStreet,
        number,
        neighborhood: resolvedNeighborhood,
        city: resolvedCity,
        uf: resolvedUf,
      });
      if (!geo) {
        res.status(400).json({ message: 'Não foi possível geocodar o endereço informado.' });
        return;
      }
      lat = geo.latitude;
      lng = geo.longitude;
    }

    const origin: BusinessOrigin = {
      cep,
      street: resolvedStreet,
      number,
      complement: complement || undefined,
      neighborhood: resolvedNeighborhood || '',
      city: resolvedCity,
      uf: resolvedUf,
      latitude: lat,
      longitude: lng,
    };

    await setBusinessOrigin(origin);
    res.json({ origin });
  } catch (err) {
    next(err);
  }
};

/* ─── Faixas de entrega ─── */

export const getZones = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const zones = await getDeliveryZones();
    res.json({ zones });
  } catch (err) {
    next(err);
  }
};

/* ─── Mesas (salão) ─── */

export const getTables = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tableCount = await getTableCount();
    res.json({ tableCount });
  } catch (err) {
    next(err);
  }
};

export const updateTables = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const count = parseInt(req.body.tableCount, 10);
    if (isNaN(count) || count < 0 || count > 200) {
      res.status(400).json({ message: 'tableCount deve ser um número entre 0 e 200.' });
      return;
    }
    await setTableCount(count);
    res.json({ tableCount: count });
  } catch (err) {
    next(err);
  }
};

export const updateZones = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { zones } = req.body ?? {};
    if (!Array.isArray(zones) || zones.length === 0) {
      res.status(400).json({ message: 'zones deve ser um array de { minKm, maxKm, fee }.' });
      return;
    }
    for (const z of zones) {
      if (typeof z.minKm !== 'number' || typeof z.maxKm !== 'number' || typeof z.fee !== 'number' ||
          z.minKm < 0 || z.maxKm <= z.minKm || z.fee < 0) {
        res.status(400).json({ message: 'Cada faixa precisa de minKm ≥ 0, maxKm > minKm e fee ≥ 0.' });
        return;
      }
    }
    const sorted = [...(zones as DeliveryZone[])].sort((a, b) => a.minKm - b.minKm);
    await setDeliveryZones(sorted);
    res.json({ zones: sorted });
  } catch (err) {
    next(err);
  }
};

/* ─── Horário de funcionamento (RF27) ─── */

export const getOpeningHoursCtrl = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const openingHours = await getOpeningHours();
    res.json({ openingHours, openNow: openingHours ? estaAberto(openingHours) : null });
  } catch (err) {
    next(err);
  }
};

export const updateOpeningHours = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = req.body?.openingHours;
    const error = validarOpeningHours(input);
    if (error) {
      res.status(400).json({ message: error });
      return;
    }
    const openingHours = normalizarOpeningHours(input);
    await setOpeningHours(openingHours);
    res.json({ openingHours, openNow: estaAberto(openingHours) });
  } catch (err) {
    next(err);
  }
};
