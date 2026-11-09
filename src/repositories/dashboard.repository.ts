import { getPool } from '../database/mysqlClient';
import { getBusinessContext } from '../database/businessContext';

function getDateFilter(period: string): string {
  switch (period) {
    case 'day':   return `AND o.createdAt >= DATE(NOW())`;
    case 'week':  return `AND o.createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
    case 'month': return `AND o.createdAt >= DATE_SUB(NOW(), INTERVAL 1 MONTH)`;
    default:      return `AND o.createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
  }
}

function getDateFilterNoAlias(period: string): string {
  switch (period) {
    case 'day':   return `AND createdAt >= DATE(NOW())`;
    case 'week':  return `AND createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
    case 'month': return `AND createdAt >= DATE_SUB(NOW(), INTERVAL 1 MONTH)`;
    default:      return `AND createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
  }
}

export const getStats = async (period: string = 'week') => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const dateF = getDateFilterNoAlias(period);

  const [counts] = await pool.query<any[]>(`
    SELECT
      (SELECT COUNT(*) FROM Orders WHERE businessId = ? ${dateF}) AS totalOrders,
      (SELECT COUNT(*) FROM Orders WHERE businessId = ? AND status NOT IN ('OUT_FOR_DELIVERY', 'DELIVERED') ${dateF}) AS pendingOrders,
      (SELECT COUNT(*) FROM Customers WHERE businessId = ?) AS totalCustomers,
      (SELECT COUNT(*) FROM Products WHERE businessId = ?) AS totalProducts,
      (SELECT IFNULL(SUM(total), 0) FROM Orders WHERE businessId = ? ${dateF}) AS totalRevenue
  `, [businessId, businessId, businessId, businessId, businessId]);

  const [recentOrders] = await pool.query<any[]>(`
    SELECT o.id, o.total, o.status, o.createdAt, o.tableNumber,
           COALESCE(c.name, CONCAT('Mesa ', o.tableNumber)) AS customerName
    FROM Orders o
    LEFT JOIN Customers c ON o.customerId = c.id
    WHERE o.businessId = ? ${getDateFilter(period)}
    ORDER BY o.createdAt DESC
    LIMIT 5
  `, [businessId]);

  const [topProducts] = await pool.query<any[]>(`
    SELECT p.name,
           SUM(oi.quantity) AS totalSold,
           SUM(oi.quantity * oi.finalPrice) AS totalRevenue
    FROM OrderItems oi
    INNER JOIN Products p ON oi.productId = p.id
    INNER JOIN Orders o ON oi.orderId = o.id
    WHERE o.businessId = ? ${getDateFilter(period)}
    GROUP BY p.name
    ORDER BY totalSold DESC
    LIMIT 5
  `, [businessId]);

  const row = (counts as any[])[0];
  return {
    totalOrders: row.totalOrders,
    pendingOrders: row.pendingOrders,
    totalCustomers: row.totalCustomers,
    totalProducts: row.totalProducts,
    totalRevenue: parseFloat(row.totalRevenue),
    recentOrders: (recentOrders as any[]).map((o: any) => ({
      id: o.id,
      customerName: o.customerName,
      total: parseFloat(o.total),
      status: o.status,
      createdAt: o.createdAt
    })),
    topProducts: (topProducts as any[]).map((p: any) => ({
      name: p.name,
      totalSold: p.totalSold,
      totalRevenue: parseFloat(p.totalRevenue)
    }))
  };
};

export const getAnalytics = async (period: string = 'week') => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const dateF = getDateFilter(period);
  const dateNoAlias = getDateFilterNoAlias(period);

  const [periodStats] = await pool.query<any[]>(`
    SELECT
      IFNULL(SUM(total), 0) AS periodRevenue,
      COUNT(*) AS periodOrders,
      IFNULL(AVG(total), 0) AS avgTicket
    FROM Orders
    WHERE businessId = ? ${dateNoAlias}
  `, [businessId]);

  const [avgDelivery] = await pool.query<any[]>(`
    SELECT IFNULL(AVG(TIMESTAMPDIFF(MINUTE, createdAt, deliveredAt)), 0) AS avgMinutes
    FROM Orders
    WHERE businessId = ? AND status = 'DELIVERED' AND deliveredAt IS NOT NULL ${dateNoAlias}
  `, [businessId]);

  const [topProductPeriod] = await pool.query<any[]>(`
    SELECT p.name
    FROM OrderItems oi
    INNER JOIN Orders o ON oi.orderId = o.id
    INNER JOIN Products p ON oi.productId = p.id
    WHERE o.businessId = ? ${dateF}
    GROUP BY p.name
    ORDER BY SUM(oi.quantity) DESC
    LIMIT 1
  `, [businessId]);

  const [salesByDay] = await pool.query<any[]>(`
    SELECT DATE(o.createdAt) AS day, COUNT(*) AS orders, IFNULL(SUM(o.total), 0) AS revenue
    FROM Orders o
    WHERE o.businessId = ? ${dateF}
    GROUP BY DATE(o.createdAt)
    ORDER BY day ASC
  `, [businessId]);

  const [topProducts] = await pool.query<any[]>(`
    SELECT p.name, p.category,
           SUM(oi.quantity) AS totalSold,
           SUM(oi.quantity * oi.finalPrice) AS totalRevenue
    FROM OrderItems oi
    INNER JOIN Products p ON oi.productId = p.id
    INNER JOIN Orders o ON oi.orderId = o.id
    WHERE o.businessId = ? ${dateF}
    GROUP BY p.name, p.category
    ORDER BY totalSold DESC
    LIMIT 10
  `, [businessId]);

  const [revenueByPayment] = await pool.query<any[]>(`
    SELECT IFNULL(paymentMethod, 'nao_informado') AS method,
           COUNT(*) AS count,
           IFNULL(SUM(total), 0) AS revenue
    FROM Orders
    WHERE businessId = ? ${dateNoAlias}
    GROUP BY paymentMethod
  `, [businessId]);

  const [ordersByHour] = await pool.query<any[]>(`
    SELECT HOUR(createdAt) AS hour, COUNT(*) AS count
    FROM Orders
    WHERE businessId = ? ${dateNoAlias}
    GROUP BY HOUR(createdAt)
    ORDER BY hour ASC
  `, [businessId]);

  const [revenueByCategory] = await pool.query<any[]>(`
    SELECT IFNULL(p.category, 'Sem Categoria') AS category,
           SUM(oi.quantity) AS totalSold,
           SUM(oi.quantity * oi.finalPrice) AS totalRevenue
    FROM OrderItems oi
    INNER JOIN Products p ON oi.productId = p.id
    INNER JOIN Orders o ON oi.orderId = o.id
    WHERE o.businessId = ? ${dateF}
    GROUP BY p.category
    ORDER BY totalRevenue DESC
  `, [businessId]);

  const [ordersByChannel] = await pool.query<any[]>(`
    SELECT IFNULL(channel, 'balcao') AS channel, COUNT(*) AS count, IFNULL(SUM(total), 0) AS revenue
    FROM Orders
    WHERE businessId = ? ${dateNoAlias}
    GROUP BY channel
  `, [businessId]);

  const [ordersByStatus] = await pool.query<any[]>(`
    SELECT status, COUNT(*) AS count
    FROM Orders
    WHERE businessId = ? ${dateNoAlias}
    GROUP BY status
  `, [businessId]);

  const [ticketByDay] = await pool.query<any[]>(`
    SELECT DATE(createdAt) AS day, IFNULL(AVG(total), 0) AS avgTicket
    FROM Orders
    WHERE businessId = ? ${dateNoAlias}
    GROUP BY DATE(createdAt)
    ORDER BY day ASC
  `, [businessId]);

  const stats = (periodStats as any[])[0];
  return {
    todayRevenue: parseFloat(stats.periodRevenue),
    todayOrders: stats.periodOrders,
    avgTicket: parseFloat(stats.avgTicket),
    avgDeliveryTime: (avgDelivery as any[])[0].avgMinutes,
    topProductName: (topProductPeriod as any[])[0]?.name || '—',
    salesByDay: (salesByDay as any[]).map((r: any) => ({ day: r.day, orders: r.orders, revenue: parseFloat(r.revenue) })),
    topProducts: (topProducts as any[]).map((r: any) => ({ name: r.name, category: r.category, totalSold: r.totalSold, totalRevenue: parseFloat(r.totalRevenue) })),
    revenueByPayment: (revenueByPayment as any[]).map((r: any) => ({ method: r.method, count: r.count, revenue: parseFloat(r.revenue) })),
    ordersByHour: (ordersByHour as any[]).map((r: any) => ({ hour: r.hour, count: r.count })),
    revenueByCategory: (revenueByCategory as any[]).map((r: any) => ({ category: r.category, totalSold: r.totalSold, totalRevenue: parseFloat(r.totalRevenue) })),
    ordersByChannel: (ordersByChannel as any[]).map((r: any) => ({ channel: r.channel, count: r.count, revenue: parseFloat(r.revenue) })),
    ordersByStatus: (ordersByStatus as any[]).map((r: any) => ({ status: r.status, count: r.count })),
    ticketByDay: (ticketByDay as any[]).map((r: any) => ({ day: r.day, avgTicket: parseFloat(r.avgTicket) }))
  };
};

/* ─── Exportação de relatórios (RF22 / RF25) ───
   `fromUtc` e `toUtc` já vêm convertidos para UTC (intervalo [fromUtc, toUtc)). */

export const getOrdersForExport = async (fromUtc: Date, toUtc: Date) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const [rows] = await pool.query<any[]>(`
    SELECT o.id, o.createdAt,
           COALESCE(c.name, CONCAT('Mesa ', o.tableNumber)) AS cliente,
           o.channel, o.status, o.paymentMethod, o.deliveryFee, o.total
    FROM Orders o
    LEFT JOIN Customers c ON c.id = o.customerId
    WHERE o.businessId = ? AND o.createdAt >= ? AND o.createdAt < ?
    ORDER BY o.createdAt
  `, [businessId, fromUtc, toUtc]);
  return rows;
};

/** Totais do período para o relatório de impressão. Pedidos cancelados não entram no faturamento. */
export const getExportSummary = async (fromUtc: Date, toUtc: Date) => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const range = [businessId, fromUtc, toUtc];

  const [[totals]] = await pool.query<any[]>(`
    SELECT
      COUNT(CASE WHEN status <> 'CANCELLED' THEN 1 END)               AS orders,
      IFNULL(SUM(CASE WHEN status <> 'CANCELLED' THEN total END), 0)  AS revenue,
      IFNULL(SUM(CASE WHEN status <> 'CANCELLED' THEN deliveryFee END), 0) AS deliveryFees,
      COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END)                AS cancelledOrders,
      IFNULL(SUM(CASE WHEN status = 'CANCELLED' THEN total END), 0)   AS cancelledTotal
    FROM Orders
    WHERE businessId = ? AND createdAt >= ? AND createdAt < ?
  `, range);

  const [topProducts] = await pool.query<any[]>(`
    SELECT p.name, SUM(oi.quantity) AS quantity, SUM(oi.quantity * oi.finalPrice) AS revenue
    FROM OrderItems oi
    INNER JOIN Orders o   ON o.id = oi.orderId
    INNER JOIN Products p ON p.id = oi.productId
    WHERE o.businessId = ? AND o.createdAt >= ? AND o.createdAt < ? AND o.status <> 'CANCELLED'
    GROUP BY p.id, p.name
    ORDER BY quantity DESC
    LIMIT 10
  `, range);

  const [payments] = await pool.query<any[]>(`
    SELECT IFNULL(paymentMethod, 'nao_informado') AS method, COUNT(*) AS orders, SUM(total) AS revenue
    FROM Orders
    WHERE businessId = ? AND createdAt >= ? AND createdAt < ? AND status <> 'CANCELLED'
    GROUP BY IFNULL(paymentMethod, 'nao_informado')
    ORDER BY revenue DESC
  `, range);

  const orders = Number(totals.orders);
  const revenue = parseFloat(totals.revenue);
  return {
    orders,
    revenue,
    avgTicket: orders ? Math.round((revenue / orders) * 100) / 100 : 0,
    deliveryFees: parseFloat(totals.deliveryFees),
    cancelledOrders: Number(totals.cancelledOrders),
    cancelledTotal: parseFloat(totals.cancelledTotal),
    topProducts: (topProducts as any[]).map(p => ({ name: p.name, quantity: Number(p.quantity), revenue: parseFloat(p.revenue) })),
    payments: (payments as any[]).map(p => ({ method: p.method, orders: Number(p.orders), revenue: parseFloat(p.revenue) })),
  };
};
