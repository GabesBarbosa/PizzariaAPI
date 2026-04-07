import { getPool, sql } from '../database/mssqlClient';
import { getBusinessContext } from '../database/businessContext';

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
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const dateF = getCustomerDateFilter(period);
  const dateFAlias = getCustomerDateFilter(period, 'o');

  const mkReq = () => {
    const r = conn.request();
    r.input('businessId', sql.UniqueIdentifier, businessId);
    return r;
  };

  const kpis = await mkReq().query(`
    SELECT
      (SELECT COUNT(*) FROM Customers WHERE businessId = @businessId) AS totalCustomers,
      (SELECT COUNT(*) FROM Customers WHERE businessId = @businessId ${dateF}) AS newCustomersPeriod,
      (SELECT COUNT(DISTINCT customerId) FROM Orders WHERE businessId = @businessId ${getCustomerDateFilter(period, 'o').replace('o.createdAt', 'createdAt')}) AS activeCustomersPeriod
  `);

  const recurring = await mkReq().query(`
    SELECT COUNT(*) AS recurringCustomers
    FROM (SELECT customerId FROM Orders WHERE businessId = @businessId GROUP BY customerId HAVING COUNT(*) > 1) t
  `);

  const returnRate = await mkReq().query(`
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
        FROM Orders WHERE businessId = @businessId
        GROUP BY customerId
      ) sub
    ) final
  `);

  const clv = await mkReq().query(`
    SELECT ISNULL(AVG(total), 0) AS avgCLV
    FROM (SELECT customerId, SUM(total) AS total FROM Orders WHERE businessId = @businessId GROUP BY customerId) t
  `);

  const newByDay = await mkReq().query(`
    SELECT CAST(createdAt AS DATE) AS day, COUNT(*) AS count
    FROM Customers WHERE businessId = @businessId ${dateF}
    GROUP BY CAST(createdAt AS DATE)
    ORDER BY day ASC
  `);

  const newVsRecurring = await mkReq().query(`
    SELECT
      SUM(CASE WHEN orderCount = 1 THEN 1 ELSE 0 END) AS newCustomers,
      SUM(CASE WHEN orderCount > 1 THEN 1 ELSE 0 END) AS recurringCustomers
    FROM (
      SELECT customerId, COUNT(*) AS orderCount
      FROM Orders WHERE businessId = @businessId
      GROUP BY customerId
    ) t
  `);

  const loyaltyIndex = await mkReq().query(`
    SELECT
      SUM(CASE WHEN orderCount = 1 THEN 1 ELSE 0 END) AS oneOrder,
      SUM(CASE WHEN orderCount BETWEEN 2 AND 3 THEN 1 ELSE 0 END) AS twoThreeOrders,
      SUM(CASE WHEN orderCount >= 4 THEN 1 ELSE 0 END) AS fourPlusOrders
    FROM (
      SELECT customerId, COUNT(*) AS orderCount
      FROM Orders WHERE businessId = @businessId
      GROUP BY customerId
    ) t
  `);

  const returnByMonth = await mkReq().query(`
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
        SELECT DISTINCT customerId FROM Orders
        WHERE businessId = @businessId AND createdAt < DATEADD(MONTH, -1, GETDATE())
      ) prev ON o.customerId = prev.customerId
      WHERE o.businessId = @businessId AND o.createdAt >= DATEADD(MONTH, -6, GETDATE())
      GROUP BY FORMAT(o.createdAt, 'yyyy-MM')
    ) m
    ORDER BY m.month ASC
  `);

  const growth = await mkReq().query(`
    SELECT FORMAT(createdAt, 'yyyy-MM') AS month, COUNT(*) AS newCount
    FROM Customers
    WHERE businessId = @businessId AND createdAt >= DATEADD(MONTH, -6, GETDATE())
    GROUP BY FORMAT(createdAt, 'yyyy-MM')
    ORDER BY month ASC
  `);

  const totalBefore = (await mkReq().query(`
    SELECT COUNT(*) AS c FROM Customers
    WHERE businessId = @businessId AND createdAt < DATEADD(MONTH, -6, GETDATE())
  `)).recordset[0].c;

  let cumulative = totalBefore;
  const growthData = growth.recordset.map((r: any) => {
    cumulative += r.newCount;
    return { month: r.month, total: cumulative };
  });

  const topCustomers = await mkReq().query(`
    SELECT TOP 10 c.name, SUM(o.total) AS totalSpent, COUNT(o.id) AS orderCount
    FROM Orders o
    INNER JOIN Customers c ON o.customerId = c.id
    WHERE o.businessId = @businessId
    GROUP BY c.name
    ORDER BY totalSpent DESC
  `);

  const avgInterval = await mkReq().query(`
    SELECT
      FORMAT(o2.createdAt, 'yyyy-MM') AS month,
      AVG(DATEDIFF(DAY, o1.createdAt, o2.createdAt)) AS avgDays
    FROM (
      SELECT customerId, createdAt,
        LAG(createdAt) OVER (PARTITION BY customerId ORDER BY createdAt) AS prevCreatedAt
      FROM Orders WHERE businessId = @businessId
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
    totalCustomers: kpiRow.totalCustomers,
    newCustomersPeriod: kpiRow.newCustomersPeriod,
    recurringCustomers: recurring.recordset[0].recurringCustomers,
    returnRate: parseFloat(returnRate.recordset[0].returnRate),
    avgCLV: parseFloat(clv.recordset[0].avgCLV),
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
    returnByMonth: returnByMonth.recordset.map((r: any) => ({ month: r.month, returnRate: parseFloat(r.returnRate) })),
    customerGrowth: growthData,
    topCustomers: topCustomers.recordset.map((r: any) => ({ name: r.name, totalSpent: parseFloat(r.totalSpent), orderCount: r.orderCount })),
    avgOrderInterval: avgInterval.recordset.map((r: any) => ({ month: r.month, avgDays: r.avgDays }))
  };
};
