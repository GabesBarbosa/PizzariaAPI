import { randomUUID } from 'crypto';

interface TokenEntry {
  phone: string;
  businessId: string;
  expiresAt: number;
}

const store = new Map<string, TokenEntry>();
const TTL_MS = 30 * 60 * 1000;

export function createShopToken(businessId: string, phone: string): string {
  const token = randomUUID();
  store.set(token, { phone, businessId, expiresAt: Date.now() + TTL_MS });
  return token;
}

export function redeemShopToken(token: string, businessId: string): string | null {
  const entry = store.get(token);
  store.delete(token);
  if (!entry) return null;
  if (entry.businessId !== businessId) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry.phone;
}
