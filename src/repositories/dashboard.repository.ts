import { getPool, sql } from '../database/mssqlClient';

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
  const conn = await getPool();
  const dateF = getDateFilterNoAlias(period);

  const counts = await conn.request().query(`
    SELECT
      (SELECT COUNT(*) FROM Orders WHERE 1=1 ${dateF}) AS totalOrders,
      (SELECT COUNT(*) FROM Orders WHERE status NOT IN ('OUT_FOR_DELIVERY', 'DELIVERED') ${dateF}) AS pendingOrders,
      (SELECT COUNT(*) FROM Customers) AS totalCustomers,
      (SELECT COUNT(*) FROM Products) AS totalProducts,
      (SELECT ISNULL(SUM(total), 0) FROM Orders WHERE 1=1 ${dateF}) AS totalRevenue
  `);

  const recentOrders = await conn.request().query(`
    SELECT TOP 5
      o.id, o.total, o.status, o.createdAt,
      c.name AS customerName
    FROM Orders o
    LEFT JOIN Customers c ON o.customerId = c.id
    WHERE 1=1 ${getDateFilter(period)}
    ORDER BY o.createdAt DESC
  `);

  const topProducts = await conn.request().query(`
    SELECT TOP 5
      p.name,
      SUM(oi.quantity) AS totalSold,
      SUM(oi.quantity * oi.price) AS totalRevenue
    FROM OrderItems oi
    INNER JOIN Products p ON oi.productId = p.id
    INNER JOIN Orders o ON oi.orderId = o.id
    WHERE 1=1 ${getDateFilter(period)}
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
  const conn = await getPool();
  const dateF = getDateFilter(period);
  const dateNoAlias = getDateFilterNoAlias(period);

  // Auto-migrate: add columns if they don't exist yet
  await conn.request().query(`
    IF COL_LENGTH('Orders', 'channel') IS NULL
      ALTER TABLE Orders ADD channel NVARCHAR(50) NULL DEFAULT 'balcao';
    IF COL_LENGTH('Orders', 'deliveredAt') IS NULL
      ALTER TABLE Orders ADD deliveredAt DATETIME2 NULL;
  `);

  // Period stats (KPIs)
  const periodStats = await conn.request().query(`
    SELECT
      ISNULL(SUM(total), 0) AS periodRevenue,
      COUNT(*) AS periodOrders,
      ISNULL(AVG(total), 0) AS avgTicket
    FROM Orders
    WHERE 1=1 ${dateNoAlias}
  `);

  // Average delivery time (in the selected period)
  const avgDelivery = await conn.request().query(`
    SELECT ISNULL(AVG(DATEDIFF(MINUTE, createdAt, deliveredAt)), 0) AS avgMinutes
    FROM Orders
    WHERE status = 'DELIVERED' AND deliveredAt IS NOT NULL ${dateNoAlias}
  `);

  // Top pizza in the period
  const topPizzaPeriod = await conn.request().query(`
    SELECT TOP 1 p.name
    FROM OrderItems oi
    INNER JOIN Orders o ON oi.orderId = o.id
    INNER JOIN Products p ON oi.productId = p.id
    WHERE 1=1 ${dateF}
    GROUP BY p.name
    ORDER BY SUM(oi.quantity) DESC
  `);

  // Sales per day (in the period)
  const salesByDay = await conn.request().query(`
    SELECT
      CAST(o.createdAt AS DATE) AS day,
      COUNT(*) AS orders,
      ISNULL(SUM(o.total), 0) AS revenue
    FROM Orders o
    WHERE 1=1 ${dateF}
    GROUP BY CAST(o.createdAt AS DATE)
    ORDER BY day ASC
  `);

  // Top 10 pizzas most sold in the period
  const topProducts = await conn.request().query(`
    SELECT TOP 10
      p.name,
      p.category,
      SUM(oi.quantity) AS totalSold,
      SUM(oi.quantity * oi.price) AS totalRevenue
    FROM OrderItems oi
    INNER JOIN Products p ON oi.productId = p.id
    INNER JOIN Orders o ON oi.orderId = o.id
    WHERE 1=1 ${dateF}
    GROUP BY p.name, p.category
    ORDER BY totalSold DESC
  `);

  // Revenue by payment method in the period
  const revenueByPayment = await conn.request().query(`
    SELECT
      ISNULL(paymentMethod, 'nao_informado') AS method,
      COUNT(*) AS count,
      ISNULL(SUM(total), 0) AS revenue
    FROM Orders
    WHERE 1=1 ${dateNoAlias}
    GROUP BY paymentMethod
  `);

  // Orders by hour of day in the period
  const ordersByHour = await conn.request().query(`
    SELECT
      DATEPART(HOUR, createdAt) AS hour,
      COUNT(*) AS count
    FROM Orders
    WHERE 1=1 ${dateNoAlias}
    GROUP BY DATEPART(HOUR, createdAt)
    ORDER BY hour ASC
  `);

  // Revenue by category in the period
  const revenueByCategory = await conn.request().query(`
    SELECT
      ISNULL(p.category, 'Sem Categoria') AS category,
      SUM(oi.quantity) AS totalSold,
      SUM(oi.quantity * oi.price) AS totalRevenue
    FROM OrderItems oi
    INNER JOIN Products p ON oi.productId = p.id
    INNER JOIN Orders o ON oi.orderId = o.id
    WHERE 1=1 ${dateF}
    GROUP BY p.category
    ORDER BY totalRevenue DESC
  `);

  // Orders by channel in the period
  const ordersByChannel = await conn.request().query(`
    SELECT
      ISNULL(channel, 'balcao') AS channel,
      COUNT(*) AS count,
      ISNULL(SUM(total), 0) AS revenue
    FROM Orders
    WHERE 1=1 ${dateNoAlias}
    GROUP BY channel
  `);

  // Orders by status in the period
  const ordersByStatus = await conn.request().query(`
    SELECT status, COUNT(*) AS count
    FROM Orders
    WHERE 1=1 ${dateNoAlias}
    GROUP BY status
  `);

  // Ticket médio per day in the period
  const ticketByDay = await conn.request().query(`
    SELECT
      CAST(createdAt AS DATE) AS day,
      ISNULL(AVG(total), 0) AS avgTicket
    FROM Orders
    WHERE 1=1 ${dateNoAlias}
    GROUP BY CAST(createdAt AS DATE)
    ORDER BY day ASC
  `);

  const stats = periodStats.recordset[0];
  return {
    todayRevenue: parseFloat(stats.periodRevenue),
    todayOrders: stats.periodOrders,
    avgTicket: parseFloat(stats.avgTicket),
    avgDeliveryTime: avgDelivery.recordset[0].avgMinutes,
    topPizzaName: topPizzaPeriod.recordset[0]?.name || '—',
    salesByDay: salesByDay.recordset.map((r: any) => ({
      day: r.day,
      orders: r.orders,
      revenue: parseFloat(r.revenue)
    })),
    topProducts: topProducts.recordset.map((r: any) => ({
      name: r.name,
      category: r.category,
      totalSold: r.totalSold,
      totalRevenue: parseFloat(r.totalRevenue)
    })),
    revenueByPayment: revenueByPayment.recordset.map((r: any) => ({
      method: r.method,
      count: r.count,
      revenue: parseFloat(r.revenue)
    })),
    ordersByHour: ordersByHour.recordset.map((r: any) => ({
      hour: r.hour,
      count: r.count
    })),
    revenueByCategory: revenueByCategory.recordset.map((r: any) => ({
      category: r.category,
      totalSold: r.totalSold,
      totalRevenue: parseFloat(r.totalRevenue)
    })),
    ordersByChannel: ordersByChannel.recordset.map((r: any) => ({
      channel: r.channel,
      count: r.count,
      revenue: parseFloat(r.revenue)
    })),
    ordersByStatus: ordersByStatus.recordset.map((r: any) => ({
      status: r.status,
      count: r.count
    })),
    ticketByDay: ticketByDay.recordset.map((r: any) => ({
      day: r.day,
      avgTicket: parseFloat(r.avgTicket)
    }))
  };
};
