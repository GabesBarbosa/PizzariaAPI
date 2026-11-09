import { getPool } from '../database/mysqlClient';
import { getBusinessContext } from '../database/businessContext';
import logger from '../utils/logger';
import type { OpeningHours } from '../utils/opening-hours';

const DEFAULT_DELIVERY_FEE = 5;

export const getSetting = async (key: string): Promise<string | null> => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    'SELECT value FROM Settings WHERE businessId = ? AND `key` = ?',
    [businessId, key]
  );
  return rows[0]?.value ?? null;
};

export const setSetting = async (key: string, value: string): Promise<void> => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  await pool.query(
    `INSERT INTO Settings (businessId, \`key\`, value) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updatedAt = UTC_TIMESTAMP()`,
    [businessId, key, value]
  );
};

export type ChatbotMode = 'ai' | 'triggers';
export type BusinessType = 'pizzaria' | 'hamburgueria' | 'generic';

export const setSettingForBusiness = async (businessId: string, key: string, value: string): Promise<void> => {
  const pool = getPool();
  await pool.query(
    `INSERT INTO Settings (businessId, \`key\`, value) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updatedAt = UTC_TIMESTAMP()`,
    [businessId, key, value]
  );
};

export const getBusinessType = async (): Promise<BusinessType> => {
  try {
    const v = await getSetting('businessType');
    if (v === 'pizzaria') return 'pizzaria';
    if (v === 'generic')  return 'generic';
    return 'hamburgueria';
  } catch {
    return 'hamburgueria';
  }
};

export const setBusinessType = async (type: BusinessType): Promise<void> => {
  await setSetting('businessType', type);
};

export const getChatbotMode = async (): Promise<ChatbotMode> => {
  try {
    const v = await getSetting('chatbotMode');
    return (v === 'ai' ? 'ai' : 'triggers') as ChatbotMode;
  } catch {
    return 'triggers';
  }
};

export const getChatbotEnabled = async (): Promise<boolean> => {
  try {
    const v = await getSetting('chatbotEnabled');
    return v !== 'false';
  } catch {
    return true;
  }
};

export const setChatbotEnabled = async (enabled: boolean): Promise<void> => {
  await setSetting('chatbotEnabled', enabled ? 'true' : 'false');
};

export const getDeliveryFee = async (): Promise<number> => {
  try {
    const v = await getSetting('deliveryFee');
    return v !== null ? parseFloat(v) : DEFAULT_DELIVERY_FEE;
  } catch (err: any) {
    logger.warn(`[Settings] getDeliveryFee falhou: ${err.message} — usando padrão ${DEFAULT_DELIVERY_FEE}`);
    return DEFAULT_DELIVERY_FEE;
  }
};

/* ─── Chatbot Config dinâmica por business ─── */

export interface CrustOption {
  label: string;
  price: number;
}

export interface SizeOption {
  label: string;
  maxFlavors: number;
  multiplier: number;
}

export interface PaymentOption {
  key: string;
  label: string;
}

export interface ChatbotConfig {
  businessName: string;
  crustOptions: CrustOption[];
  sizeOptions: Record<string, SizeOption>;
  paymentMethods: PaymentOption[];
}

const DEFAULT_CRUST_OPTIONS: CrustOption[] = [
  { label: 'Catupiry Original', price: 8.00 },
  { label: 'Cheddar',           price: 8.00 },
  { label: 'Chocolate',         price: 8.00 },
];

const DEFAULT_SIZE_OPTIONS: Record<string, SizeOption> = {
  normal:   { label: 'Normal',  maxFlavors: 2, multiplier: 1.00 },
  brotinho: { label: 'Pequeno', maxFlavors: 1, multiplier: 0.65 },
};

const DEFAULT_PAYMENT_METHODS: PaymentOption[] = [
  { key: 'PIX',    label: 'PIX' },
  { key: 'CREDIT', label: 'Cartão (levar maquininha)' },
  { key: 'CASH',   label: 'Dinheiro' },
];

export const getBusinessName = async (): Promise<string> => {
  const { businessId } = getBusinessContext()!;
  try {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      'SELECT name FROM Businesses WHERE id = ?',
      [businessId]
    );
    return rows[0]?.name ?? 'Nosso Delivery';
  } catch (err: any) {
    logger.warn(`[Settings] getBusinessName falhou: ${err.message}`);
    return 'Nosso Delivery';
  }
};

export const getCrustOptions = async (): Promise<CrustOption[]> => {
  try {
    const v = await getSetting('crustOptions');
    if (v) return JSON.parse(v) as CrustOption[];
  } catch { /* usa default */ }
  return DEFAULT_CRUST_OPTIONS;
};

export const setCrustOptions = async (options: CrustOption[]): Promise<void> => {
  await setSetting('crustOptions', JSON.stringify(options));
};

export const getSizeOptions = async (): Promise<Record<string, SizeOption>> => {
  try {
    const v = await getSetting('sizeOptions');
    if (v) return JSON.parse(v) as Record<string, SizeOption>;
  } catch { /* usa default */ }
  return DEFAULT_SIZE_OPTIONS;
};

export const setSizeOptions = async (options: Record<string, SizeOption>): Promise<void> => {
  await setSetting('sizeOptions', JSON.stringify(options));
};

export const getPaymentMethods = async (): Promise<PaymentOption[]> => {
  try {
    const v = await getSetting('paymentMethods');
    if (v) return JSON.parse(v) as PaymentOption[];
  } catch { /* usa default */ }
  return DEFAULT_PAYMENT_METHODS;
};

export const setPaymentMethods = async (options: PaymentOption[]): Promise<void> => {
  await setSetting('paymentMethods', JSON.stringify(options));
};

export const getChatbotConfig = async (): Promise<ChatbotConfig> => {
  const [businessName, crustOptions, sizeOptions, paymentMethods] = await Promise.all([
    getBusinessName(),
    getCrustOptions(),
    getSizeOptions(),
    getPaymentMethods(),
  ]);
  return { businessName, crustOptions, sizeOptions, paymentMethods };
};

/* ─── Origem do estabelecimento ─── */

export interface BusinessOrigin {
  cep: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  uf: string;
  latitude: number;
  longitude: number;
}

export const getBusinessOrigin = async (): Promise<BusinessOrigin | null> => {
  try {
    const v = await getSetting('businessOrigin');
    if (!v) return null;
    return JSON.parse(v) as BusinessOrigin;
  } catch {
    return null;
  }
};

export const setBusinessOrigin = async (origin: BusinessOrigin): Promise<void> => {
  await setSetting('businessOrigin', JSON.stringify(origin));
};

/* ─── Faixas de frete por km ─── */

export interface DeliveryZone {
  minKm: number;
  maxKm: number;
  fee: number;
}

const DEFAULT_DELIVERY_ZONES: DeliveryZone[] = [
  { minKm: 0, maxKm: 3,  fee: 5 },
  { minKm: 3, maxKm: 6,  fee: 8 },
  { minKm: 6, maxKm: 10, fee: 12 },
];

export const getDeliveryZones = async (): Promise<DeliveryZone[]> => {
  try {
    const v = await getSetting('deliveryZones');
    if (!v) return DEFAULT_DELIVERY_ZONES;
    const parsed = JSON.parse(v) as DeliveryZone[];
    return parsed.sort((a, b) => a.minKm - b.minKm);
  } catch {
    return DEFAULT_DELIVERY_ZONES;
  }
};

export const setDeliveryZones = async (zones: DeliveryZone[]): Promise<void> => {
  await setSetting('deliveryZones', JSON.stringify(zones));
};

/* ─── Mesas (salão) ─── */

export const getTableCount = async (): Promise<number> => {
  try {
    const v = await getSetting('tableCount');
    const n = parseInt(v ?? '0', 10);
    return isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
};

export const setTableCount = async (count: number): Promise<void> => {
  await setSetting('tableCount', count.toString());
};

/* ─── Resolução de business por slug ─── */

export interface PublicBusinessInfo {
  id: string;
  name: string;
  slug: string;
  active: boolean;
}

export const findBusinessBySlug = async (slug: string): Promise<PublicBusinessInfo | null> => {
  try {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      'SELECT id, name, slug, active FROM Businesses WHERE slug = ? AND active = 1',
      [slug]
    );
    return rows[0] ?? null;
  } catch (err: any) {
    logger.warn(`[Settings] findBusinessBySlug falhou: ${err.message}`);
    return null;
  }
};

export const getCurrentBusinessInfo = async (): Promise<PublicBusinessInfo | null> => {
  const { businessId } = getBusinessContext()!;
  try {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      'SELECT id, name, slug, active FROM Businesses WHERE id = ?',
      [businessId]
    );
    return rows[0] ?? null;
  } catch (err: any) {
    logger.warn(`[Settings] getCurrentBusinessInfo falhou: ${err.message}`);
    return null;
  }
};

/* ─── Horário de funcionamento (RF27) ─── */

export const getOpeningHours = async (): Promise<OpeningHours | null> => {
  try {
    const raw = await getSetting('opening_hours');
    return raw ? (JSON.parse(raw) as OpeningHours) : null;
  } catch {
    return null;
  }
};

export const setOpeningHours = async (h: OpeningHours): Promise<void> => {
  await setSetting('opening_hours', JSON.stringify(h));
};
