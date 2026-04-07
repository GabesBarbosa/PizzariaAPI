import { getPool, sql } from '../database/mssqlClient';
import { getBusinessContext } from '../database/businessContext';

function getDateFilter(period: string): string {
  switch (period) {
    case 'day':   return `AND o.createdAt >= CAST(GETDATE() AS DATE)`;
    case 'week':  return `AND o.createdAt >= DATEADD(DAY, -7, GETDATE())`;
    case 'month': return `AND o.createdAt >= DATEADD(MONTH, -1, GETDATE())`;
    default:      return `AND o.createdAt >= DATEADD(DAY, -7, GETDATE())`;
  }
}

function getDateFilterNoAlias(period: string): string {
  switch (period) {
    case 'day':   return `AND createdAt >= CAST(GETDATE() AS DATE)`;
    case 'week':  return `AND createdAt >= DATEADD(DAY, -7, GETDATE())`;
    case 'month': return `AND createdAt >= DATEADD(MONTH, -1, GETDATE())`;
    default:      return `AND createdAt >= DATEADD(DAY, -7, GETDATE())`;
  }
}

export const getStats = async (period: string = 'week') => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const dateF = getDateFilterNoAlias(period);

  const r = conn.request();
  r.input('businessId', sql.UniqueIdentifier, businessId);

  const counts = await r.query(`
    SELECT
      (SELECT COUNT(*) FROM Orders WHERE businessId = @businessId ${dateF}) AS totalOrders,
      (SELECT COUNT(*) FROM Orders WHERE businessId = @businessId AND status NOT IN ('OUT_FOR_DELIVERY', 'DELIVERED') ${dateF}) AS pendingOrders,
      (SELECT COUNT(*) FROM Customers WHERE businessId = @businessId) AS totalCustomers,
      (SELECT COUNT(*) FROM Products WHERE businessId = @businessId) AS totalProducts,
      (SELECT ISNULL(SUM(total), 0) FROM Orders WHERE businessId = @businessId ${dateF}) AS totalRevenue
  `);

  const r2 = conn.request();
  r2.input('businessId', sql.UniqueIdentifier, businessId);
  const recentOrders = await r2.query(`
    SELECT TOP 5
      o.id, o.total, o.status, o.createdAt,
      c.name AS customerName
    FROM Orders o
    LEFT JOIN Customers c ON o.customerId = c.id
    WHERE o.businessId = @businessId ${getDateFilter(period)}
    ORDER BY o.createdAt DESC
  `);

  const r3 = conn.request();
  r3.input('businessId', sql.UniqueIdentifier, businessId);
  const topProducts = await r3.query(`
    SELECT TOP 5
      p.name,
      SUM(oi.quantity) AS totalSold,
      SUM(oi.quantity * oi.finalPrice) AS totalRevenue
    FROM OrderItems oi
    INNER JOIN Products p ON oi.productId = p.id
    INNER JOIN Orders o ON oi.orderId = o.id
    WHERE o.businessId = @businessId ${getDateFilter(period)}
    GROUP BY p.name
    ORDER BY totalSold DESC
  `);

  const row = counts.recordset[0];
  return {
    totalOrders: row.totalOrders,
    pendingOrders: row.pendingOrders,
    totalCustomers: row.totalCustomers,
    totalProducts: row.totalProducts,
    totalRevenue: parseFloat(row.totalRevenue),
    recentOrders: recentOrders.recordset.map((o: any) => ({
      id: o.id,
      customerName: o.customerName,
      total: parseFloat(o.total),
      status: o.status,
      createdAt: o.createdAt
    })),
    topProducts: topProducts.recordset.map((p: any) => ({
      name: p.name,
      totalSold: p.totalSold,
      totalRevenue: parseFloat(p.totalRevenue)
    }))
  };
};

export const getAnalytics = async (period: string = 'week') => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const dateF = getDateFilter(period);
  const dateNoAlias = getDateFilterNoAlias(period);

  const mkReq = () => {
    const r = conn.request();
    r.input('businessId', sql.UniqueIdentifier, businessId);
    return r;
  };

  const periodStats = await mkReq().query(`
    SELECT
      ISNULL(SUM(total), 0) AS periodRevenue,
      COUNT(*) AS periodOrders,
      ISNULL(AVG(total), 0) AS avgTicket
    FROM Orders
    WHERE businessId = @businessId ${dateNoAlias}
  `);

  const avgDelivery = await mkReq().query(`
    SELECT ISNULL(AVG(DATEDIFF(MINUTE, createdAt, deliveredAt)), 0) AS avgMinutes
    FROM Orders
    WHERE businessId = @businessId AND status = 'DELIVERED' AND deliveredAt IS NOT NULL ${dateNoAlias}
  `);

  const topProductPeriod = await mkReq().query(`
    SELECT TOP 1 p.name
    FROM OrderItems oi
    INNER JOIN Orders o ON oi.orderId = o.id
    INNER JOIN Products p ON oi.productId = p.id
    WHERE o.businessId = @businessId ${dateF}
    GROUP BY p.name
    ORDER BY SUM(oi.quantity) DESC
  `);

  const salesByDay = await mkReq().query(`
    SELECT
      CAST(o.createdAt AS DATE) AS day,
      COUNT(*) AS orders,
      ISNULL(SUM(o.total), 0) AS revenue
    FROM Orders o
    WHERE o.businessId = @businessId ${dateF}
    GROUP BY CAST(o.createdAt AS DATE)
    ORDER BY day ASC
  `);

  const topProducts = await mkReq().query(`
    SELECT TOP 10
      p.name,
      p.category,
      SUM(oi.quantity) AS totalSold,
      SUM(oi.quantity * oi.finalPrice) AS totalRevenue
    FROM OrderItems oi
    INNER JOIN Products p ON oi.productId = p.id
    INNER JOIN Orders o ON oi.orderId = o.id
    WHERE o.businessId = @businessId ${dateF}
    GROUP BY p.name, p.category
    ORDER BY totalSold DESC
  `);

  const revenueByPayment = await mkReq().query(`
    SELECT
      ISNULL(paymentMethod, 'nao_informado') AS method,
      COUNT(*) AS count,
      ISNULL(SUM(total), 0) AS revenue
    FROM Orders
    WHERE businessId = @businessId ${dateNoAlias}
    GROUP BY paymentMethod
  `);

  const ordersByHour = await mkReq().query(`
    SELECT
      DATEPART(HOUR, createdAt) AS hour,
      COUNT(*) AS count
    FROM Orders
    WHERE businessId = @businessId ${dateNoAlias}
    GROUP BY DATEPART(HOUR, createdAt)
    ORDER BY hour ASC
  `);

  const revenueByCategory = await mkReq().query(`
    SELECT
      ISNULL(p.category, 'Sem Categoria') AS category,
      SUM(oi.quantity) AS totalSold,
      SUM(oi.quantity * oi.finalPrice) AS totalRevenue
    FROM OrderItems oi
    INNER JOIN Products p ON oi.productId = p.id
    INNER JOIN Orders o ON oi.orderId = o.id
    WHERE o.businessId = @businessId ${dateF}
    GROUP BY p.category
    ORDER BY totalRevenue DESC
  `);

  const ordersByChannel = await mkReq().query(`
    SELECT
      ISNULL(channel, 'balcao') AS channel,
      COUNT(*) AS count,
      ISNULL(SUM(total), 0) AS revenue
    FROM Orders
    WHERE businessId = @businessId ${dateNoAlias}
    GROUP BY channel
  `);

  const ordersByStatus = await mkReq().query(`
    SELECT status, COUNT(*) AS count
    FROM Orders
    WHERE businessId = @businessId ${dateNoAlias}
    GROUP BY status
  `);

  const ticketByDay = await mkReq().query(`
    SELECT
      CAST(createdAt AS DATE) AS day,
      ISNULL(AVG(total), 0) AS avgTicket
    FROM Orders
    WHERE businessId = @businessId ${dateNoAlias}
    GROUP BY CAST(createdAt AS DATE)
    ORDER BY day ASC
  `);

  const stats = periodStats.recordset[0];
  return {
    todayRevenue: parseFloat(stats.periodRevenue),
    todayOrders: stats.periodOrders,
    avgTicket: parseFloat(stats.avgTicket),
    avgDeliveryTime: avgDelivery.recordset[0].avgMinutes,
    topProductName: topProductPeriod.recordset[0]?.name || '—',
    salesByDay: salesByDay.recordset.map((r: any) => ({ day: r.day, orders: r.orders, revenue: parseFloat(r.revenue) })),
    topProducts: topProducts.recordset.map((r: any) => ({ name: r.name, category: r.category, totalSold: r.totalSold, totalRevenue: parseFloat(r.totalRevenue) })),
    revenueByPayment: revenueByPayment.recordset.map((r: any) => ({ method: r.method, count: r.count, revenue: parseFloat(r.revenue) })),
    ordersByHour: ordersByHour.recordset.map((r: any) => ({ hour: r.hour, count: r.count })),
    revenueByCategory: revenueByCategory.recordset.map((r: any) => ({ category: r.category, totalSold: r.totalSold, totalRevenue: parseFloat(r.totalRevenue) })),
    ordersByChannel: ordersByChannel.recordset.map((r: any) => ({ channel: r.channel, count: r.count, revenue: parseFloat(r.revenue) })),
    ordersByStatus: ordersByStatus.recordset.map((r: any) => ({ status: r.status, count: r.count })),
    ticketByDay: ticketByDay.recordset.map((r: any) => ({ day: r.day, avgTicket: parseFloat(r.avgTicket) }))
  };
};
