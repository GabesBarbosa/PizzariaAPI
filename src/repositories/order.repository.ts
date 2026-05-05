import { getPool, sql } from '../database/mssqlClient';
import { getBusinessContext } from '../database/businessContext';
import { CreateOrderDTO, CreateOrderItemDTO } from '../dtos/order.dto';
import { v4 as uuidv4 } from 'uuid';

interface ItemWithPrice {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  finalPrice: number;
  variations: Array<{ variationId: string; priceModifier: number }>;
}

async function calcItemPrice(
  transaction: any,
  it: CreateOrderItemDTO
): Promise<ItemWithPrice> {
  const req1 = new sql.Request(transaction);
  const r1 = await req1
    .input('pid', sql.UniqueIdentifier, it.productId)
    .query('SELECT price FROM Products WHERE id = @pid');
  if (!r1.recordset[0]) throw new Error('Produto não encontrado: ' + it.productId);

  const unitPrice = parseFloat(r1.recordset[0].price);
  let variationTotal = 0;
  const variationSnapshots: Array<{ variationId: string; priceModifier: number }> = [];

  if (it.variations?.length) {
    for (const v of it.variations) {
      const vReq = new sql.Request(transaction);
      const vRes = await vReq
        .input('vid', sql.UniqueIdentifier, v.variationId)
        .query('SELECT priceModifier FROM ProductVariations WHERE id = @vid');
      if (!vRes.recordset[0]) throw new Error('Variação não encontrada: ' + v.variationId);
      const modifier = parseFloat(vRes.recordset[0].priceModifier);
      variationTotal += modifier;
      variationSnapshots.push({ variationId: v.variationId, priceModifier: modifier });
    }
  }

  const finalPrice = Math.round((unitPrice + variationTotal) * 100) / 100;

  return {
    id: uuidv4(),
    productId: it.productId,
    quantity: it.quantity,
    unitPrice,
    finalPrice,
    variations: variationSnapshots
  };
}

async function insertItems(transaction: any, orderId: number, items: ItemWithPrice[]) {
  for (const it of items) {
    const req = new sql.Request(transaction);
    await req
      .input('iid', sql.UniqueIdentifier, it.id)
      .input('oid', sql.Int, orderId)
      .input('pid', sql.UniqueIdentifier, it.productId)
      .input('quantity', sql.Int, it.quantity)
      .input('unitPrice', sql.Decimal(10, 2), it.unitPrice)
      .input('finalPrice', sql.Decimal(10, 2), it.finalPrice)
      .query(
        `INSERT INTO OrderItems (id, orderId, productId, quantity, unitPrice, finalPrice)
         VALUES (@iid, @oid, @pid, @quantity, @unitPrice, @finalPrice)`
      );

    for (const v of it.variations) {
      const vReq = new sql.Request(transaction);
      await vReq
        .input('id', sql.UniqueIdentifier, uuidv4())
        .input('orderItemId', sql.UniqueIdentifier, it.id)
        .input('variationId', sql.UniqueIdentifier, v.variationId)
        .input('priceModifier', sql.Decimal(10, 2), v.priceModifier)
        .query(
          `INSERT INTO OrderItemVariations (id, orderItemId, variationId, priceModifier)
           VALUES (@id, @orderItemId, @variationId, @priceModifier)`
        );
    }
  }
}

export const createOrder = async (data: CreateOrderDTO) => {
  const { businessId } = getBusinessContext()!;
  const connection = await getPool();
  const transaction = new sql.Transaction(connection);
  try {
    await transaction.begin();

    let itemsTotal = 0;
    const itemsWithPrice: ItemWithPrice[] = [];
    for (const it of data.items) {
      const item = await calcItemPrice(transaction, it);
      itemsWithPrice.push(item);
      itemsTotal += item.finalPrice * it.quantity;
    }

    const deliveryFee = data.deliveryFee || 0;
    const grandTotal = Math.round((itemsTotal + deliveryFee) * 100) / 100;

    const orderReq = new sql.Request(transaction as any);
    const orderInsert = await orderReq
      .input('businessId', sql.UniqueIdentifier, businessId)
      .input('customerId', sql.UniqueIdentifier, data.customerId ?? null)
      .input('total', sql.Decimal(12, 2), grandTotal)
      .input('paymentMethod', sql.NVarChar(50), data.paymentMethod || null)
      .input('deliveryAddress', sql.NVarChar(500), data.deliveryAddress || null)
      .input('notes', sql.NVarChar(1000), data.notes || null)
      .input('deliveryFee', sql.Decimal(10, 2), deliveryFee)
      .input('channel', sql.NVarChar(50), data.channel || 'balcao')
      .input('tableNumber', sql.Int, data.tableNumber ?? null)
      .query(
        `INSERT INTO Orders (businessId, customerId, total, status, paymentMethod, deliveryAddress, notes, deliveryFee, channel, tableNumber)
         OUTPUT inserted.id
         VALUES (@businessId, @customerId, @total, 'RECEIVED', @paymentMethod, @deliveryAddress, @notes, @deliveryFee, @channel, @tableNumber)`
      );
    const orderId: number = orderInsert.recordset[0].id;

    await insertItems(transaction as any, orderId, itemsWithPrice);
    await transaction.commit();

    return findOrderById(orderId);
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* ignore */ }
    throw err;
  }
};

export const findAllOrders = async () => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const req = conn.request();
  req.input('businessId', sql.UniqueIdentifier, businessId);
  const result = await req.query(`
    SELECT o.*, c.name AS customerName
    FROM Orders o
    LEFT JOIN Customers c ON o.customerId = c.id
    WHERE o.businessId = @businessId
    ORDER BY o.createdAt DESC
  `);
  return result.recordset;
};

export const findOrdersByCustomer = async (customerId: string) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const req = conn.request();
  req.input('customerId', sql.UniqueIdentifier, customerId);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  const orders = await req.query(
    'SELECT * FROM Orders WHERE customerId = @customerId AND businessId = @businessId ORDER BY createdAt DESC'
  );
  return orders.recordset;
};

export const findOrderById = async (orderId: number) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const req = conn.request();
  req.input('id', sql.Int, orderId);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  const orderRes = await req.query(`
    SELECT o.*, c.name AS customerName
    FROM Orders o
    LEFT JOIN Customers c ON o.customerId = c.id
    WHERE o.id = @id AND o.businessId = @businessId
  `);
  if (!orderRes.recordset[0]) return null;

  const itemsReq = conn.request();
  itemsReq.input('oid', sql.Int, orderId);
  const itemsRes = await itemsReq.query(`
    SELECT oi.*, p.name AS productName
    FROM OrderItems oi
    LEFT JOIN Products p ON oi.productId = p.id
    WHERE oi.orderId = @oid
  `);

  const items = itemsRes.recordset;

  for (const item of items) {
    const vReq = conn.request();
    vReq.input('orderItemId', sql.UniqueIdentifier, item.id);
    const vRes = await vReq.query(`
      SELECT oiv.*, pv.name AS variationName, pv.type AS variationType
      FROM OrderItemVariations oiv
      LEFT JOIN ProductVariations pv ON oiv.variationId = pv.id
      WHERE oiv.orderItemId = @orderItemId
    `);
    item.variations = vRes.recordset;
  }

  return { ...orderRes.recordset[0], items };
};

export const updateOrderStatus = async (orderId: number, status: string) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const req = conn.request();
  req.input('id', sql.Int, orderId);
  req.input('status', sql.NVarChar(50), status);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  const query = status === 'DELIVERED'
    ? `UPDATE Orders SET status = @status, deliveredAt = SYSUTCDATETIME() OUTPUT inserted.* WHERE id = @id AND businessId = @businessId`
    : `UPDATE Orders SET status = @status OUTPUT inserted.* WHERE id = @id AND businessId = @businessId`;
  const res = await req.query(query);
  return res.recordset[0];
};

export const deleteOrder = async (orderId: number) => {
  const { businessId } = getBusinessContext()!;
  const connection = await getPool();
  const transaction = new sql.Transaction(connection);
  try {
    await transaction.begin();

    // Delete OrderItemVariations first
    const oivReq = new sql.Request(transaction as any);
    await oivReq.input('oid', sql.Int, orderId).query(`
      DELETE oiv FROM OrderItemVariations oiv
      INNER JOIN OrderItems oi ON oiv.orderItemId = oi.id
      WHERE oi.orderId = @oid
    `);

    const itemsReq = new sql.Request(transaction as any);
    await itemsReq.input('oid', sql.Int, orderId)
      .query('DELETE FROM OrderItems WHERE orderId = @oid');

    const orderReq = new sql.Request(transaction as any);
    const res = await orderReq
      .input('id', sql.Int, orderId)
      .input('businessId', sql.UniqueIdentifier, businessId)
      .query('DELETE FROM Orders WHERE id = @id AND businessId = @businessId');

    await transaction.commit();
    return res.rowsAffected[0] > 0;
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* ignore */ }
    throw err;
  }
};

export const updateOrder = async (orderId: number, data: CreateOrderDTO) => {
  const { businessId } = getBusinessContext()!;
  const connection = await getPool();
  const transaction = new sql.Transaction(connection);
  try {
    await transaction.begin();

    // Delete old variations and items
    const oivReq = new sql.Request(transaction as any);
    await oivReq.input('oid', sql.Int, orderId).query(`
      DELETE oiv FROM OrderItemVariations oiv
      INNER JOIN OrderItems oi ON oiv.orderItemId = oi.id
      WHERE oi.orderId = @oid
    `);

    const delReq = new sql.Request(transaction as any);
    await delReq.input('oid', sql.Int, orderId)
      .query('DELETE FROM OrderItems WHERE orderId = @oid');

    let itemsTotal = 0;
    const itemsWithPrice: ItemWithPrice[] = [];
    for (const it of data.items) {
      const item = await calcItemPrice(transaction, it);
      itemsWithPrice.push(item);
      itemsTotal += item.finalPrice * it.quantity;
    }

    const deliveryFee = data.deliveryFee || 0;
    const grandTotal = Math.round((itemsTotal + deliveryFee) * 100) / 100;

    const updReq = new sql.Request(transaction as any);
    await updReq
      .input('id', sql.Int, orderId)
      .input('businessId', sql.UniqueIdentifier, businessId)
      .input('customerId', sql.UniqueIdentifier, data.customerId ?? null)
      .input('total', sql.Decimal(12, 2), grandTotal)
      .input('paymentMethod', sql.NVarChar(50), data.paymentMethod || null)
      .input('deliveryAddress', sql.NVarChar(500), data.deliveryAddress || null)
      .input('notes', sql.NVarChar(1000), data.notes || null)
      .input('deliveryFee', sql.Decimal(10, 2), deliveryFee)
      .query(`
        UPDATE Orders SET
          customerId = @customerId, total = @total,
          paymentMethod = @paymentMethod, deliveryAddress = @deliveryAddress,
          notes = @notes, deliveryFee = @deliveryFee
        WHERE id = @id AND businessId = @businessId
      `);

    await insertItems(transaction as any, orderId, itemsWithPrice);
    await transaction.commit();

    return findOrderById(orderId);
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* ignore */ }
    throw err;
  }
};
