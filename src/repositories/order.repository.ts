import { getPool, sql } from '../database/mssqlClient';
import { CreateOrderDTO, CreateOrderItemDTO } from '../dtos/order.dto';
import { v4 as uuidv4 } from 'uuid';

export const createOrder = async (data: CreateOrderDTO) => {
  const connection = await getPool();
  const transaction = new sql.Transaction(connection);
  try {
    await transaction.begin();
    const tRequest = new sql.Request(transaction as any);

    // calculate prices and total
    let total = 0;
    const itemsWithPrice: Array<{ id: string; productId: string; quantity: number; price: number }> = [];
    for (const it of data.items) {
      const r = await tRequest.input('pid', sql.UniqueIdentifier, it.productId)
        .query('SELECT price FROM Products WHERE id = @pid');
      const product = r.recordset[0];
      if (!product) throw new Error('Produto não encontrado: ' + it.productId);
      const price = parseFloat(product.price);
      const itemId = uuidv4();
      itemsWithPrice.push({ id: itemId, productId: it.productId, quantity: it.quantity, price });
      total += price * it.quantity;
    }

    const orderId = uuidv4();
    // insert order
    await tRequest.input('id', sql.UniqueIdentifier, orderId)
      .input('customerId', sql.UniqueIdentifier, data.customerId)
      .input('total', sql.Decimal(12, 2), total)
      .input('status', sql.NVarChar(50), 'RECEIVED')
      .query(`INSERT INTO Orders (id, customerId, total, status)
              VALUES (@id, @customerId, @total, @status)`);

    // insert items
    for (const it of itemsWithPrice) {
      await tRequest.input('iid', sql.UniqueIdentifier, it.id)
        .input('oid', sql.UniqueIdentifier, orderId)
        .input('pid', sql.UniqueIdentifier, it.productId)
        .input('quantity', sql.Int, it.quantity)
        .input('price', sql.Decimal(10,2), it.price)
        .query(`INSERT INTO OrderItems (id, orderId, productId, quantity, price)
                VALUES (@iid, @oid, @pid, @quantity, @price)`);
    }

    await transaction.commit();

    // return created order and items
    const poolConn = await getPool();
    const orderResult = await poolConn.request().input('oid', sql.UniqueIdentifier, orderId)
      .query('SELECT * FROM Orders WHERE id = @oid');
    const itemsResult = await poolConn.request().input('oid', sql.UniqueIdentifier, orderId)
      .query('SELECT * FROM OrderItems WHERE orderId = @oid');

    return { ...orderResult.recordset[0], items: itemsResult.recordset };
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* ignore */ }
    throw err;
  }
};

export const findOrdersByCustomer = async (customerId: string) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('customerId', sql.UniqueIdentifier, customerId);
  const orders = await req.query('SELECT * FROM Orders WHERE customerId = @customerId ORDER BY createdAt DESC');
  return orders.recordset;
};

export const updateOrderStatus = async (orderId: string, status: string) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('id', sql.UniqueIdentifier, orderId);
  req.input('status', sql.NVarChar(50), status);
  const res = await req.query(`UPDATE Orders SET status = @status OUTPUT inserted.* WHERE id = @id`);
  return res.recordset[0];
};
