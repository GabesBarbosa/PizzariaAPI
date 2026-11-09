import mysql from 'mysql2/promise';
import { getPool } from '../database/mysqlClient';
import { getBusinessContext } from '../database/businessContext';
import { CreateOrderDTO, CreateOrderItemDTO } from '../dtos/order.dto';
import { v4 as uuidv4 } from 'uuid';
import { decrementStock, incrementStock } from './product.repository';

interface ItemWithPrice {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  finalPrice: number;
  variations: Array<{ variationId: string; priceModifier: number }>;
}

async function calcItemPrice(conn: mysql.PoolConnection, it: CreateOrderItemDTO): Promise<ItemWithPrice> {
  const [r1] = await conn.query<any[]>('SELECT price FROM Products WHERE id = ?', [it.productId]);
  if (!r1[0]) throw new Error('Produto não encontrado: ' + it.productId);

  const unitPrice = parseFloat(r1[0].price);
  let variationTotal = 0;
  const variationSnapshots: Array<{ variationId: string; priceModifier: number }> = [];

  if (it.variations?.length) {
    for (const v of it.variations) {
      const [vRes] = await conn.query<any[]>(
        'SELECT priceModifier FROM ProductVariations WHERE id = ?', [v.variationId]
      );
      if (!vRes[0]) throw new Error('Variação não encontrada: ' + v.variationId);
      const modifier = parseFloat(vRes[0].priceModifier);
      variationTotal += modifier;
      variationSnapshots.push({ variationId: v.variationId, priceModifier: modifier });
    }
  }

  const finalPrice = Math.round((unitPrice + variationTotal) * 100) / 100;
  return { id: uuidv4(), productId: it.productId, quantity: it.quantity, unitPrice, finalPrice, variations: variationSnapshots };
}

/** Devolve ao estoque tudo que o pedido já havia consumido. */
async function restoreStockForOrder(conn: mysql.PoolConnection, orderId: number) {
  const [rows] = await conn.query<any[]>(
    'SELECT productId, quantity FROM OrderItems WHERE orderId = ? AND productId IS NOT NULL',
    [orderId]
  );
  for (const row of rows) {
    await incrementStock(conn, row.productId, row.quantity);
  }
}

async function insertItems(conn: mysql.PoolConnection, orderId: number, items: ItemWithPrice[]) {
  for (const it of items) {
    // Baixa de estoque na mesma transação: se faltar saldo, o pedido inteiro é revertido.
    await decrementStock(conn, it.productId, it.quantity);

    await conn.query(
      'INSERT INTO OrderItems (id, orderId, productId, quantity, unitPrice, finalPrice) VALUES (?, ?, ?, ?, ?, ?)',
      [it.id, orderId, it.productId, it.quantity, it.unitPrice, it.finalPrice]
    );
    for (const v of it.variations) {
      await conn.query(
        'INSERT INTO OrderItemVariations (id, orderItemId, variationId, priceModifier) VALUES (?, ?, ?, ?)',
        [uuidv4(), it.id, v.variationId, v.priceModifier]
      );
    }
  }
}

export const createOrder = async (data: CreateOrderDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let itemsTotal = 0;
    const itemsWithPrice: ItemWithPrice[] = [];
    for (const it of data.items) {
      const item = await calcItemPrice(conn, it);
      itemsWithPrice.push(item);
      itemsTotal += item.finalPrice * it.quantity;
    }

    const deliveryFee = data.deliveryFee || 0;
    const grandTotal = Math.round((itemsTotal + deliveryFee) * 100) / 100;

    const [orderResult] = await conn.query(
      `INSERT INTO Orders (businessId, customerId, total, status, paymentMethod, deliveryAddress, notes, deliveryFee, channel, tableNumber)
       VALUES (?, ?, ?, 'RECEIVED', ?, ?, ?, ?, ?, ?)`,
      [businessId, data.customerId ?? null, grandTotal, data.paymentMethod || null,
       data.deliveryAddress || null, data.notes || null, deliveryFee, data.channel || 'balcao',
       data.tableNumber ?? null]
    );
    const orderId: number = (orderResult as any).insertId;

    await insertItems(conn, orderId, itemsWithPrice);
    await conn.commit();
    return findOrderById(orderId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

export const findAllOrders = async () => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const [rows] = await pool.query<any[]>(`
    SELECT o.*, c.name AS customerName
    FROM Orders o
    LEFT JOIN Customers c ON o.customerId = c.id
    WHERE o.businessId = ?
    ORDER BY o.createdAt DESC
  `, [businessId]);
  return rows;
};

export const findOrdersByCustomer = async (customerId: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    'SELECT * FROM Orders WHERE customerId = ? AND businessId = ? ORDER BY createdAt DESC',
    [customerId, businessId]
  );
  return rows;
};

export const findOrderById = async (orderId: number) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const [orderRes] = await pool.query<any[]>(`
    SELECT o.*, c.name AS customerName
    FROM Orders o
    LEFT JOIN Customers c ON o.customerId = c.id
    WHERE o.id = ? AND o.businessId = ?
  `, [orderId, businessId]);
  if (!orderRes[0]) return null;

  const [itemsRes] = await pool.query<any[]>(`
    SELECT oi.*, p.name AS productName
    FROM OrderItems oi
    LEFT JOIN Products p ON oi.productId = p.id
    WHERE oi.orderId = ?
  `, [orderId]);

  const items = itemsRes as any[];
  for (const item of items) {
    const [vRes] = await pool.query<any[]>(`
      SELECT oiv.*, pv.name AS variationName, pv.type AS variationType
      FROM OrderItemVariations oiv
      LEFT JOIN ProductVariations pv ON oiv.variationId = pv.id
      WHERE oiv.orderItemId = ?
    `, [item.id]);
    item.variations = vRes;
  }

  return { ...orderRes[0], items };
};

export const updateOrderStatus = async (orderId: number, status: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [currentRows] = await conn.query<any[]>(
      'SELECT status FROM Orders WHERE id = ? AND businessId = ?', [orderId, businessId]
    );
    const previousStatus = currentRows[0]?.status;

    if (status === 'DELIVERED') {
      await conn.query(
        'UPDATE Orders SET status = ?, deliveredAt = UTC_TIMESTAMP() WHERE id = ? AND businessId = ?',
        [status, orderId, businessId]
      );
    } else {
      await conn.query(
        'UPDATE Orders SET status = ? WHERE id = ? AND businessId = ?',
        [status, orderId, businessId]
      );
    }

    // Cancelar devolve as unidades ao estoque; reabrir um pedido cancelado dá baixa de novo.
    if (status === 'CANCELLED' && previousStatus !== 'CANCELLED') {
      await restoreStockForOrder(conn, orderId);
    } else if (previousStatus === 'CANCELLED' && status !== 'CANCELLED') {
      const [items] = await conn.query<any[]>(
        'SELECT productId, quantity FROM OrderItems WHERE orderId = ? AND productId IS NOT NULL',
        [orderId]
      );
      for (const item of items) {
        await decrementStock(conn, item.productId, item.quantity);
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const [rows] = await pool.query<any[]>('SELECT * FROM Orders WHERE id = ?', [orderId]);
  return rows[0];
};

export const deleteOrder = async (orderId: number) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Pedido cancelado já devolveu o estoque em updateOrderStatus.
    const [statusRows] = await conn.query<any[]>(
      'SELECT status FROM Orders WHERE id = ? AND businessId = ?', [orderId, businessId]
    );
    if (statusRows[0] && statusRows[0].status !== 'CANCELLED') {
      await restoreStockForOrder(conn, orderId);
    }

    await conn.query(`
      DELETE oiv FROM OrderItemVariations oiv
      INNER JOIN OrderItems oi ON oiv.orderItemId = oi.id
      WHERE oi.orderId = ?
    `, [orderId]);

    await conn.query('DELETE FROM OrderItems WHERE orderId = ?', [orderId]);

    const [res] = await conn.query(
      'DELETE FROM Orders WHERE id = ? AND businessId = ?',
      [orderId, businessId]
    );

    await conn.commit();
    return (res as any).affectedRows > 0;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

export const updateOrder = async (orderId: number, data: CreateOrderDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Devolve o que os itens antigos reservaram; insertItems dá baixa nos novos.
    await restoreStockForOrder(conn, orderId);

    await conn.query(`
      DELETE oiv FROM OrderItemVariations oiv
      INNER JOIN OrderItems oi ON oiv.orderItemId = oi.id
      WHERE oi.orderId = ?
    `, [orderId]);

    await conn.query('DELETE FROM OrderItems WHERE orderId = ?', [orderId]);

    let itemsTotal = 0;
    const itemsWithPrice: ItemWithPrice[] = [];
    for (const it of data.items) {
      const item = await calcItemPrice(conn, it);
      itemsWithPrice.push(item);
      itemsTotal += item.finalPrice * it.quantity;
    }

    const deliveryFee = data.deliveryFee || 0;
    const grandTotal = Math.round((itemsTotal + deliveryFee) * 100) / 100;

    await conn.query(
      `UPDATE Orders SET
         customerId = ?, total = ?,
         paymentMethod = ?, deliveryAddress = ?,
         notes = ?, deliveryFee = ?
       WHERE id = ? AND businessId = ?`,
      [data.customerId ?? null, grandTotal, data.paymentMethod || null,
       data.deliveryAddress || null, data.notes || null, deliveryFee,
       orderId, businessId]
    );

    await insertItems(conn, orderId, itemsWithPrice);
    await conn.commit();
    return findOrderById(orderId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};
