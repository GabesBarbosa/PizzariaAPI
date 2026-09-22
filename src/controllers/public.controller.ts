import { Response, NextFunction } from 'express';
import * as productRepo from '../repositories/product.repository';
import * as customerRepo from '../repositories/customer.repository';
import { createOrder } from '../services/order.service';
import { redeemShopToken } from '../services/shop-token.service';
import { getPaymentMethods, getBusinessOrigin, getDeliveryZones } from '../repositories/settings.repository';
import { getBusinessContext } from '../database/businessContext';
import { getPool } from '../database/mysqlClient';
import { lookupCep } from '../services/geocoding.service';
import { quoteShipping } from '../services/delivery.service';
import logger from '../utils/logger';
import type { PublicRequest } from '../middlewares/publicBusiness.middleware';

/* ─── GET /api/public/:slug/business ─── */

export const getBusiness = async (req: PublicRequest, res: Response, next: NextFunction) => {
  try {
    const [paymentMethods, origin, zones] = await Promise.all([
      getPaymentMethods(),
      getBusinessOrigin(),
      getDeliveryZones(),
    ]);

    res.json({
      id: req.business!.id,
      name: req.business!.name,
      slug: req.business!.slug,
      paymentMethods,
      hasOrigin: !!origin,
      deliveryZones: zones,
      originCity: origin ? `${origin.city}/${origin.uf}` : null,
    });
  } catch (err) {
    next(err);
  }
};

/* ─── GET /api/public/:slug/menu ─── */

export const getMenu = async (_req: PublicRequest, res: Response, next: NextFunction) => {
  try {
    const [products, variations] = await Promise.all([
      productRepo.getAllProducts(),
      productRepo.getAllVariationsForBusiness(),
    ]);
    const variationsByProduct = groupVariationsByProduct(variations);

    const byCategory: Record<string, any[]> = {};
    for (const p of products) {
      const cat = p.category || 'outros';
      const stockQuantity = p.stockQuantity === null || p.stockQuantity === undefined
        ? null
        : Number(p.stockQuantity);
      (byCategory[cat] ||= []).push({
        id: p.id,
        name: p.name,
        description: p.description,
        price: parseFloat(p.price),
        category: cat,
        imageBase64: p.imageBase64 || null,
        stockQuantity,
        available: stockQuantity === null || stockQuantity > 0,
        variations: variationsByProduct.get(p.id) || [],
      });
    }
    res.json({ categories: byCategory });
  } catch (err) {
    next(err);
  }
};

/* ─── GET /api/public/:slug/top-products ─── */

export const getTopProducts = async (_req: PublicRequest, res: Response, next: NextFunction) => {
  try {
    const { businessId } = getBusinessContext()!;
    const pool = getPool();
    const [rows] = await pool.query<any[]>(`
      SELECT
        p.id, p.name, p.description, p.price, p.category, p.imageBase64, p.stockQuantity,
        SUM(oi.quantity) AS totalSold
      FROM OrderItems oi
      INNER JOIN Orders o ON oi.orderId = o.id
      INNER JOIN Products p ON oi.productId = p.id
      WHERE o.businessId = ?
        AND o.createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND o.status NOT IN ('CANCELLED')
      GROUP BY p.id, p.name, p.description, p.price, p.category, p.imageBase64, p.stockQuantity
      ORDER BY totalSold DESC
      LIMIT 6
    `, [businessId]);

    const variations = await productRepo.getAllVariationsForBusiness();
    const variationsByProduct = groupVariationsByProduct(variations);

    res.json(rows.map((p: any) => {
      const stockQuantity = p.stockQuantity === null || p.stockQuantity === undefined
        ? null
        : Number(p.stockQuantity);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        price: parseFloat(p.price),
        category: p.category,
        imageBase64: p.imageBase64 || null,
        stockQuantity,
        available: stockQuantity === null || stockQuantity > 0,
        totalSold: p.totalSold,
        variations: variationsByProduct.get(p.id) || [],
      };
    }));
  } catch (err) {
    next(err);
  }
};

/* ─── GET /api/public/cep/:cep ─── */

export const getCep = async (req: PublicRequest, res: Response, next: NextFunction) => {
  try {
    const info = await lookupCep(req.params.cep);
    if (!info) {
      return res.status(404).json({ message: 'CEP não encontrado.' });
    }
    res.json(info);
  } catch (err) {
    next(err);
  }
};

/* ─── POST /api/public/:slug/shipping ─── */

export const postShipping = async (req: PublicRequest, res: Response, next: NextFunction) => {
  try {
    const { cep, number, street, neighborhood, city, uf } = req.body ?? {};
    if (!cep || typeof cep !== 'string') {
      return res.status(400).json({ message: 'CEP é obrigatório.' });
    }
    const quote = await quoteShipping({ cep, number, street, neighborhood, city, uf });
    res.json({
      distanceKm: quote.distanceKm,
      fee: quote.fee,
      outOfRange: quote.outOfRange,
    });
  } catch (err: any) {
    res.status(400).json({ message: err.message || 'Falha ao calcular o frete.' });
  }
};

/* ─── GET /api/public/:slug/customers?token=... ─── */

export const getCustomerByToken = async (req: PublicRequest, res: Response, next: NextFunction) => {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (!token) return res.status(400).json({ message: 'Token é obrigatório.' });

    const phone = redeemShopToken(token, req.business!.id);
    if (!phone) return res.status(404).json({ message: 'Token inválido ou expirado.' });

    const customer = await customerRepo.findCustomerByPhone(phone);
    if (!customer) return res.status(404).json({ message: 'Cliente não encontrado.' });

    res.json({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      cep: customer.cep,
      street: customer.street,
      number: customer.number,
      complement: customer.complement,
      neighborhood: customer.neighborhood,
      city: customer.city,
      uf: customer.uf,
    });
  } catch (err) {
    next(err);
  }
};

/* ─── GET /api/public/:slug/customers/lookup?phone=... ─── */

export const lookupCustomerByPhone = async (req: PublicRequest, res: Response, next: NextFunction) => {
  try {
    const phone = typeof req.query.phone === 'string' ? req.query.phone.trim() : '';
    if (!phone) return res.status(400).json({ message: 'Telefone é obrigatório.' });

    const customer = await customerRepo.findCustomerByPhone(phone);
    if (!customer) return res.status(404).json({ message: 'Cliente não encontrado.' });

    res.json({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      cep: customer.cep,
      street: customer.street,
      number: customer.number,
      complement: customer.complement,
      neighborhood: customer.neighborhood,
      city: customer.city,
      uf: customer.uf,
    });
  } catch (err) {
    next(err);
  }
};

/* ─── POST /api/public/:slug/customers ─── */

export const postCustomer = async (req: PublicRequest, res: Response, next: NextFunction) => {
  try {
    const { name, phone, tableNumber: custTableNumber, cep, street, number, complement, neighborhood, city, uf, latitude, longitude } = req.body ?? {};

    // Modo mesa: phone é opcional — usa identificador da mesa como chave
    const isTableMode = !phone && custTableNumber;
    const resolvedPhone = isTableMode
      ? `mesa_${custTableNumber}`
      : (phone && typeof phone === 'string' ? customerRepo.normalizePhone(phone) : null);

    if (!resolvedPhone) {
      return res.status(400).json({ message: 'Telefone é obrigatório.' });
    }

    const resolvedName = (name && typeof name === 'string' && name.trim())
      ? name.trim()
      : `Mesa ${custTableNumber}`;

    const address = [street, number].filter(Boolean).join(', ') +
      (neighborhood ? ` - ${neighborhood}` : '') +
      (city && uf ? `, ${city}/${uf}` : '');

    const customer = await customerRepo.upsertCustomerByPhone({
      name: resolvedName,
      phone: resolvedPhone,
      address: address.trim() || undefined,
      cep, street, number, complement, neighborhood, city, uf,
      latitude, longitude,
    });

    res.json({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      cep: customer.cep,
      street: customer.street,
      number: customer.number,
      complement: customer.complement,
      neighborhood: customer.neighborhood,
      city: customer.city,
      uf: customer.uf,
    });
  } catch (err) {
    next(err);
  }
};

/* ─── POST /api/public/:slug/orders ─── */

export const postOrder = async (req: PublicRequest, res: Response, next: NextFunction) => {
  try {
    const { customerId, items, paymentMethod, changeFor, notes, deliveryFee, deliveryAddress, tableNumber } = req.body ?? {};

    const isTableOrder = !!tableNumber;
    if (!customerId && !isTableOrder) return res.status(400).json({ message: 'customerId é obrigatório.' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Itens obrigatórios.' });
    }

    const normalizedItems = items.map((it: any) => ({
      productId: it.productId,
      quantity:  Math.max(1, Math.min(50, Math.round(Number(it.quantity || 1)))),
      size:      it.size,
      halfProductId: it.halfProductId,
      variations: Array.isArray(it.variations) ? it.variations : undefined,
    }));

    let orderNotes = typeof notes === 'string' ? notes.trim() : '';
    if (paymentMethod && /dinheiro/i.test(paymentMethod) && changeFor) {
      const amount = parseFloat(String(changeFor));
      if (!Number.isNaN(amount) && amount > 0) {
        orderNotes = (orderNotes ? orderNotes + ' | ' : '') + `Troco para R$ ${amount.toFixed(2)}`;
      }
    }

    const order = await createOrder({
      customerId,
      items: normalizedItems,
      paymentMethod,
      deliveryAddress: deliveryAddress || undefined,
      deliveryFee: typeof deliveryFee === 'number' ? deliveryFee : 0,
      notes: orderNotes || undefined,
      channel: tableNumber ? 'mesa' : 'web',
      tableNumber: typeof tableNumber === 'number' ? tableNumber : undefined,
    });

    logger.info(`[Public] Pedido #${order!.id} criado via web (${req.business!.slug})`);

    res.status(201).json({ id: order!.id, total: order!.total, status: order!.status });
  } catch (err) {
    next(err);
  }
};

/* ─── Helpers ─── */

/** Agrupa as variações (já filtradas por negócio) por productId, no formato exposto ao cardápio público. */
function groupVariationsByProduct(variations: any[]): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const v of variations) {
    const list = map.get(v.productId) || [];
    list.push({
      id: v.id,
      name: v.name,
      type: v.type,
      priceModifier: parseFloat(v.priceModifier),
    });
    map.set(v.productId, list);
  }
  return map;
}

