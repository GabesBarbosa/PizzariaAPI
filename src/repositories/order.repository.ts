import { getPool, sql } from '../database/mssqlClient';
import { CreateOrderDTO, CreateOrderItemDTO } from '../dtos/order.dto';
import { v4 as uuidv4 } from 'uuid';

const BROTINHO_MULTIPLIER = 0.65;

interface ItemWithPrice {
  id: string; productId: string; quantity: number; price: number;
  size: string; halfProductId: string | null;
}

async function calcItemPrice(transaction: any, it: CreateOrderItemDTO): Promise<{ price: number; item: ItemWithPrice }> {
  const req1 = new sql.Request(transaction);
  const r1 = await req1.input('pid', sql.UniqueIdentifier, it.productId)
    .query('SELECT price FROM Products WHERE id = @pid');
  if (!r1.recordset[0]) throw new Error('Produto não encontrado: ' + it.productId);
  let price = parseFloat(r1.recordset[0].price);

  if (it.halfProductId) {
    const req2 = new sql.Request(transaction);
    const r2 = await req2.input('pid2', sql.UniqueIdentifier, it.halfProductId)
      .query('SELECT price FROM Products WHERE id = @pid2');
    if (!r2.recordset[0]) throw new Error('Produto não encontrado: ' + it.halfProductId);
    price = Math.max(price, parseFloat(r2.recordset[0].price));
  }

  const size = it.size || 'normal';
  if (size === 'brotinho') price = Math.round(price * BROTINHO_MULTIPLIER * 100) / 100;

  return {
    price,
    item: { id: uuidv4(), productId: it.productId, quantity: it.quantity, price, size, halfProductId: it.halfProductId || null }
  };
}

async function insertItems(transaction: any, orderId: number, items: ItemWithPrice[]) {
  for (const it of items) {
    const req = new sql.Request(transaction);
    await req.input('iid', sql.UniqueIdentifier, it.id)
      .input('oid', sql.Int, orderId)
      .input('pid', sql.UniqueIdentifier, it.productId)
      .input('quantity', sql.Int, it.quantity)
      .input('price', sql.Decimal(10, 2), it.price)
      .input('size', sql.NVarChar(20), it.size)
      .input('hpid', sql.UniqueIdentifier, it.halfProductId)
      .query(`INSERT INTO OrderItems (id, orderId, productId, quantity, price, size, halfProductId)
              VALUES (@iid, @oid, @pid, @quantity, @price, @size, @hpid)`);
  }
}

export const createOrder = async (data: CreateOrderDTO) => {
  const connection = await getPool();
  const transaction = new sql.Transaction(connection);
  try {
    await transaction.begin();

    // calculate prices and total
    let total = 0;
    const itemsWithPrice: ItemWithPrice[] = [];
    for (const it of data.items) {
      const { price, item } = await calcItemPrice(transaction, it);
      itemsWithPrice.push(item);
      total += price * it.quantity;
    }

    // insert order (id is INT IDENTITY, auto-generated)
    const orderReq = new sql.Request(transaction as any);
    const deliveryFee = data.deliveryFee || 0;
    const grandTotal = total + deliveryFee;
    const orderInsert = await orderReq
      .input('customerId', sql.UniqueIdentifier, data.customerId)
      .input('total', sql.Decimal(12, 2), grandTotal)
      .input('status', sql.NVarChar(50), 'RECEIVED')
      .input('paymentMethod', sql.NVarChar(50), data.paymentMethod || null)
      .input('deliveryAddress', sql.NVarChar(500), data.deliveryAddress || null)
      .input('notes', sql.NVarChar(1000), data.notes || null)
      .input('deliveryFee', sql.Decimal(10, 2), deliveryFee)
      .input('channel', sql.NVarChar(50), data.channel || 'balcao')
      .query(`INSERT INTO Orders (customerId, total, status, paymentMethod, deliveryAddress, notes, deliveryFee, channel)
              OUTPUT inserted.id
              VALUES (@customerId, @total, @status, @paymentMethod, @deliveryAddress, @notes, @deliveryFee, @channel)`);
    const orderId: number = orderInsert.recordset[0].id;

    await insertItems(transaction as any, orderId, itemsWithPrice);

    await transaction.commit();

    // return created order and items
    const poolConn = await getPool();
    const orderResult = await poolConn.request().input('oid', sql.Int, orderId)
      .query('SELECT * FROM Orders WHERE id = @oid');
    const itemsResult = await poolConn.request().input('oid', sql.Int, orderId)
      .query('SELECT * FROM OrderItems WHERE orderId = @oid');

    return { ...orderResult.recordset[0], items: itemsResult.recordset };
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* ignore */ }
    throw err;
  }
};

export const findAllOrders = async () => {
  const conn = await getPool();
  const req = conn.request();
  const result = await req.query(`
    SELECT o.*, c.name AS customerName
    FROM Orders o
    LEFT JOIN Customers c ON o.customerId = c.id
    ORDER BY o.createdAt DESC
  `);
  return result.recordset;
};

export const findOrdersByCustomer = async (customerId: string) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('customerId', sql.UniqueIdentifier, customerId);
  const orders = await req.query('SELECT * FROM Orders WHERE customerId = @customerId ORDER BY createdAt DESC');
  return orders.recordset;
};

export const updateOrderStatus = async (orderId: number, status: string) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('id', sql.Int, orderId);
  req.input('status', sql.NVarChar(50), status);
  const query = status === 'DELIVERED'
    ? `UPDATE Orders SET status = @status, deliveredAt = SYSUTCDATETIME() OUTPUT inserted.* WHERE id = @id`
    : `UPDATE Orders SET status = @status OUTPUT inserted.* WHERE id = @id`;
  const res = await req.query(query);
  return res.recordset[0];
};

export const findOrderById = async (orderId: number) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('id', sql.Int, orderId);
  const orderRes = await req.query(`
    SELECT o.*, c.name AS customerName
    FROM Orders o
    LEFT JOIN Customers c ON o.customerId = c.id
    WHERE o.id = @id
  `);
  if (!orderRes.recordset[0]) return null;
  const itemsReq = conn.request();
  itemsReq.input('oid', sql.Int, orderId);
  const itemsRes = await itemsReq.query(`
    SELECT oi.*, p.name AS productName, hp.name AS halfProductName
    FROM OrderItems oi
    LEFT JOIN Products p ON oi.productId = p.id
    LEFT JOIN Products hp ON oi.halfProductId = hp.id
    WHERE oi.orderId = @oid
  `);
  return { ...orderRes.recordset[0], items: itemsRes.recordset };
};

export const deleteOrder = async (orderId: number) => {
  const connection = await getPool();
  const transaction = new sql.Transaction(connection);
  try {
    await transaction.begin();
    const itemsReq = new sql.Request(transaction as any);
    await itemsReq.input('oid', sql.Int, orderId)
      .query('DELETE FROM OrderItems WHERE orderId = @oid');
    const orderReq = new sql.Request(transaction as any);
    const res = await orderReq.input('id', sql.Int, orderId)
      .query('DELETE FROM Orders WHERE id = @id');
    await transaction.commit();
    return res.rowsAffected[0] > 0;
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* ignore */ }
    throw err;
  }
};

export const updateOrder = async (orderId: number, data: CreateOrderDTO) => {
  const connection = await getPool();
  const transaction = new sql.Transaction(connection);
  try {
    await transaction.begin();

    // delete old items
    const delReq = new sql.Request(transaction as any);
    await delReq.input('oid', sql.Int, orderId)
      .query('DELETE FROM OrderItems WHERE orderId = @oid');

    // recalculate prices
    let total = 0;
    const itemsWithPrice: ItemWithPrice[] = [];
    for (const it of data.items) {
      const { price, item } = await calcItemPrice(transaction, it);
      itemsWithPrice.push(item);
      total += price * it.quantity;
    }

    // update order
    const updReq = new sql.Request(transaction as any);
    const deliveryFee = data.deliveryFee || 0;
    const grandTotal = total + deliveryFee;
    await updReq.input('id', sql.Int, orderId)
      .input('customerId', sql.UniqueIdentifier, data.customerId)
      .input('total', sql.Decimal(12, 2), grandTotal)
      .input('paymentMethod', sql.NVarChar(50), data.paymentMethod || null)
      .input('deliveryAddress', sql.NVarChar(500), data.deliveryAddress || null)
      .input('notes', sql.NVarChar(1000), data.notes || null)
      .input('deliveryFee', sql.Decimal(10, 2), deliveryFee)
      .query(`UPDATE Orders SET customerId = @customerId, total = @total,
              paymentMethod = @paymentMethod, deliveryAddress = @deliveryAddress,
              notes = @notes, deliveryFee = @deliveryFee WHERE id = @id`);

    await insertItems(transaction as any, orderId, itemsWithPrice);

    await transaction.commit();

    const poolConn = await getPool();
    const orderResult = await poolConn.request().input('oid', sql.Int, orderId)
      .query('SELECT * FROM Orders WHERE id = @oid');
    const itemsResult = await poolConn.request().input('oid', sql.Int, orderId)
      .query('SELECT * FROM OrderItems WHERE orderId = @oid');

    return { ...orderResult.recordset[0], items: itemsResult.recordset };
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* ignore */ }
    throw err;
  }
};
