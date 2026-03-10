import { getPool, sql } from '../database/mssqlClient';

function getCustomerDateFilter(period: string, alias: string = ''): string {
  const col = alias ? `${alias}.createdAt` : 'createdAt';
  switch (period) {
    case 'day':   return `AND ${col} >= CAST(GETDATE() AS DATE)`;
    case 'week':  return `AND ${col} >= DATEADD(DAY, -7, GETDATE())`;
    case 'month': return `AND ${col} >= DATEADD(MONTH, -1, GETDATE())`;
    default:      return `AND ${col} >= DATEADD(DAY, -7, GETDATE())`;
  }
}

export const getCustomerAnalytics = async (period: string = 'week') => {
  const conn = await getPool();
  const dateF = getCustomerDateFilter(period);
  const dateFAlias = getCustomerDateFilter(period, 'o');

  // KPIs
  const kpis = await conn.request().query(`
    SELECT
      (SELECT COUNT(*) FROM Customers) AS totalCustomers,
      (SELECT COUNT(*) FROM Customers WHERE 1=1 ${dateF}) AS newCustomersPeriod,
      (SELECT COUNT(DISTINCT customerId) FROM Orders WHERE 1=1 ${getCustomerDateFilter(period, '').replace('createdAt', 'Orders.createdAt')}) AS activeCustomersPeriod
  `);

  // Recurring customers (placed more than 1 order ever)
  const recurring = await conn.request().query(`
    SELECT COUNT(*) AS recurringCustomers
    FROM (SELECT customerId FROM Orders GROUP BY customerId HAVING COUNT(*) > 1) t
  `);

  // Return rate: % of customers who came back in the period
  const returnRate = await conn.request().query(`
    SELECT
      CASE WHEN totalActive = 0 THEN 0
        ELSE CAST(returning * 100.0 / totalActive AS DECIMAL(5,1))
      END AS returnRate
    FROM (
      SELECT
        COUNT(DISTINCT customerId) AS totalActive,
        COUNT(DISTINCT CASE WHEN orderCount > 1 THEN customerId END) AS returning
      FROM (
        SELECT customerId, COUNT(*) AS orderCount
        FROM Orders
        GROUP BY customerId
      ) sub
    ) final
  `);

  // CLV (average lifetime value per customer)
  const clv = await conn.request().query(`
    SELECT ISNULL(AVG(total), 0) AS avgCLV
    FROM (SELECT customerId, SUM(total) AS total FROM Orders GROUP BY customerId) t
  `);

  // 1. New customers by day (period)
  const newByDay = await conn.request().query(`
    SELECT CAST(createdAt AS DATE) AS day, COUNT(*) AS count
    FROM Customers WHERE 1=1 ${dateF}
    GROUP BY CAST(createdAt AS DATE)
    ORDER BY day ASC
  `);

  // 2. New vs recurring (donut) — in the period
  const newVsRecurring = await conn.request().query(`
    SELECT
      SUM(CASE WHEN orderCount = 1 THEN 1 ELSE 0 END) AS newCustomers,
      SUM(CASE WHEN orderCount > 1 THEN 1 ELSE 0 END) AS recurringCustomers
    FROM (
      SELECT customerId, COUNT(*) AS orderCount
      FROM Orders
      GROUP BY customerId
    ) t
  `);

  // 3. Loyalty index (bar) — 1 order / 2-3 / 4+
  const loyaltyIndex = await conn.request().query(`
    SELECT
      SUM(CASE WHEN orderCount = 1 THEN 1 ELSE 0 END) AS oneOrder,
      SUM(CASE WHEN orderCount BETWEEN 2 AND 3 THEN 1 ELSE 0 END) AS twoThreeOrders,
      SUM(CASE WHEN orderCount >= 4 THEN 1 ELSE 0 END) AS fourPlusOrders
    FROM (
      SELECT customerId, COUNT(*) AS orderCount
      FROM Orders
      GROUP BY customerId
    ) t
  `);

  // 4. Return rate by month (line) — last 6 months
  const returnByMonth = await conn.request().query(`
    SELECT
      m.month,
      CASE WHEN m.totalActive = 0 THEN 0
        ELSE CAST(m.returning * 100.0 / m.totalActive AS DECIMAL(5,1))
      END AS returnRate
    FROM (
      SELECT
        FORMAT(o.createdAt, 'yyyy-MM') AS month,
        COUNT(DISTINCT o.customerId) AS totalActive,
        COUNT(DISTINCT CASE WHEN prev.customerId IS NOT NULL THEN o.customerId END) AS returning
      FROM Orders o
      LEFT JOIN (
        SELECT DISTINCT customerId
        FROM Orders
        WHERE createdAt < DATEADD(MONTH, -1, GETDATE())
      ) prev ON o.customerId = prev.customerId
      WHERE o.createdAt >= DATEADD(MONTH, -6, GETDATE())
      GROUP BY FORMAT(o.createdAt, 'yyyy-MM')
    ) m
    ORDER BY m.month ASC
  `);

  // 5. Customer base growth (area) — last 6 months cumulative
  const growth = await conn.request().query(`
    SELECT
      FORMAT(createdAt, 'yyyy-MM') AS month,
      COUNT(*) AS newCount
    FROM Customers
    WHERE createdAt >= DATEADD(MONTH, -6, GETDATE())
    GROUP BY FORMAT(createdAt, 'yyyy-MM')
    ORDER BY month ASC
  `);

  // Build cumulative growth
  const totalBefore = (await conn.request().query(`
    SELECT COUNT(*) AS c FROM Customers WHERE createdAt < DATEADD(MONTH, -6, GETDATE())
  `)).recordset[0].c;

  let cumulative = totalBefore;
  const growthData = growth.recordset.map((r: any) => {
    cumulative += r.newCount;
    return { month: r.month, total: cumulative };
  });

  // 6. Top customers (bar) — by total spent
  const topCustomers = await conn.request().query(`
    SELECT TOP 10 c.name, SUM(o.total) AS totalSpent, COUNT(o.id) AS orderCount
    FROM Orders o
    INNER JOIN Customers c ON o.customerId = c.id
    GROUP BY c.name
    ORDER BY totalSpent DESC
  `);

  // 7. Average days between orders (line) — last 6 months
  const avgInterval = await conn.request().query(`
    SELECT
      FORMAT(o2.createdAt, 'yyyy-MM') AS month,
      AVG(DATEDIFF(DAY, o1.createdAt, o2.createdAt)) AS avgDays
    FROM (
      SELECT customerId, createdAt,
        LAG(createdAt) OVER (PARTITION BY customerId ORDER BY createdAt) AS prevCreatedAt
      FROM Orders
    ) o2
    CROSS APPLY (SELECT o2.prevCreatedAt AS createdAt) o1
    WHERE o1.createdAt IS NOT NULL
      AND o2.createdAt >= DATEADD(MONTH, -6, GETDATE())
    GROUP BY FORMAT(o2.createdAt, 'yyyy-MM')
    ORDER BY month ASC
  `);

  const kpiRow = kpis.recordset[0];
  const nvr = newVsRecurring.recordset[0];
  const li = loyaltyIndex.recordset[0];

  return {
    // KPIs
    totalCustomers: kpiRow.totalCustomers,
    newCustomersPeriod: kpiRow.newCustomersPeriod,
    recurringCustomers: recurring.recordset[0].recurringCustomers,
    returnRate: parseFloat(returnRate.recordset[0].returnRate),
    avgCLV: parseFloat(clv.recordset[0].avgCLV),

    // Charts
    newByDay: newByDay.recordset.map((r: any) => ({ day: r.day, count: r.count })),
    newVsRecurring: {
      newCustomers: nvr.newCustomers || 0,
      recurringCustomers: nvr.recurringCustomers || 0
    },
    loyaltyIndex: {
      oneOrder: li.oneOrder || 0,
      twoThreeOrders: li.twoThreeOrders || 0,
      fourPlusOrders: li.fourPlusOrders || 0
    },
    returnByMonth: returnByMonth.recordset.map((r: any) => ({
      month: r.month,
      returnRate: parseFloat(r.returnRate)
    })),
    customerGrowth: growthData,
    topCustomers: topCustomers.recordset.map((r: any) => ({
      name: r.name,
      totalSpent: parseFloat(r.totalSpent),
      orderCount: r.orderCount
    })),
    avgOrderInterval: avgInterval.recordset.map((r: any) => ({
      month: r.month,
      avgDays: r.avgDays
    }))
  };
};
