import { getPool } from '../database/mysqlClient';
import { getBusinessContext } from '../database/businessContext';

function getCustomerDateFilter(period: string, alias: string = ''): string {
  const col = alias ? `${alias}.createdAt` : 'createdAt';
  switch (period) {
    case 'day':   return `AND ${col} >= DATE(NOW())`;
    case 'week':  return `AND ${col} >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
    case 'month': return `AND ${col} >= DATE_SUB(NOW(), INTERVAL 1 MONTH)`;
    default:      return `AND ${col} >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
  }
}

export const getCustomerAnalytics = async (period: string = 'week') => {
  const { businessId } = getBusinessContext()!;
  const pool = getPool();
  const dateF = getCustomerDateFilter(period);
  const dateFAlias = getCustomerDateFilter(period, 'o');

  const [kpis] = await pool.query<any[]>(`
    SELECT
      (SELECT COUNT(*) FROM Customers WHERE businessId = ?) AS totalCustomers,
      (SELECT COUNT(*) FROM Customers WHERE businessId = ? ${dateF}) AS newCustomersPeriod,
      (SELECT COUNT(DISTINCT customerId) FROM Orders WHERE businessId = ? ${dateFAlias.replace('o.createdAt', 'createdAt')}) AS activeCustomersPeriod
  `, [businessId, businessId, businessId]);

  const [recurring] = await pool.query<any[]>(`
    SELECT COUNT(*) AS recurringCustomers
    FROM (SELECT customerId FROM Orders WHERE businessId = ? GROUP BY customerId HAVING COUNT(*) > 1) t
  `, [businessId]);

  const [returnRate] = await pool.query<any[]>(`
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
        FROM Orders WHERE businessId = ?
        GROUP BY customerId
      ) sub
    ) final
  `, [businessId]);

  const [clv] = await pool.query<any[]>(`
    SELECT IFNULL(AVG(total), 0) AS avgCLV
    FROM (SELECT customerId, SUM(total) AS total FROM Orders WHERE businessId = ? GROUP BY customerId) t
  `, [businessId]);

  const [newByDay] = await pool.query<any[]>(`
    SELECT DATE(createdAt) AS day, COUNT(*) AS count
    FROM Customers WHERE businessId = ? ${dateF}
    GROUP BY DATE(createdAt)
    ORDER BY day ASC
  `, [businessId]);

  const [newVsRecurring] = await pool.query<any[]>(`
    SELECT
      SUM(CASE WHEN orderCount = 1 THEN 1 ELSE 0 END) AS newCustomers,
      SUM(CASE WHEN orderCount > 1 THEN 1 ELSE 0 END) AS recurringCustomers
    FROM (
      SELECT customerId, COUNT(*) AS orderCount
      FROM Orders WHERE businessId = ?
      GROUP BY customerId
    ) t
  `, [businessId]);

  const [loyaltyIndex] = await pool.query<any[]>(`
    SELECT
      SUM(CASE WHEN orderCount = 1 THEN 1 ELSE 0 END) AS oneOrder,
      SUM(CASE WHEN orderCount BETWEEN 2 AND 3 THEN 1 ELSE 0 END) AS twoThreeOrders,
      SUM(CASE WHEN orderCount >= 4 THEN 1 ELSE 0 END) AS fourPlusOrders
    FROM (
      SELECT customerId, COUNT(*) AS orderCount
      FROM Orders WHERE businessId = ?
      GROUP BY customerId
    ) t
  `, [businessId]);

  const [returnByMonth] = await pool.query<any[]>(`
    SELECT
      m.month,
      CASE WHEN m.totalActive = 0 THEN 0
        ELSE CAST(m.returning * 100.0 / m.totalActive AS DECIMAL(5,1))
      END AS returnRate
    FROM (
      SELECT
        DATE_FORMAT(o.createdAt, '%Y-%m') AS month,
        COUNT(DISTINCT o.customerId) AS totalActive,
        COUNT(DISTINCT CASE WHEN prev.customerId IS NOT NULL THEN o.customerId END) AS returning
      FROM Orders o
      LEFT JOIN (
        SELECT DISTINCT customerId FROM Orders
        WHERE businessId = ? AND createdAt < DATE_SUB(NOW(), INTERVAL 1 MONTH)
      ) prev ON o.customerId = prev.customerId
      WHERE o.businessId = ? AND o.createdAt >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY DATE_FORMAT(o.createdAt, '%Y-%m')
    ) m
    ORDER BY m.month ASC
  `, [businessId, businessId]);

  const [growth] = await pool.query<any[]>(`
    SELECT DATE_FORMAT(createdAt, '%Y-%m') AS month, COUNT(*) AS newCount
    FROM Customers
    WHERE businessId = ? AND createdAt >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
    GROUP BY DATE_FORMAT(createdAt, '%Y-%m')
    ORDER BY month ASC
  `, [businessId]);

  const [totalBeforeRes] = await pool.query<any[]>(`
    SELECT COUNT(*) AS c FROM Customers
    WHERE businessId = ? AND createdAt < DATE_SUB(NOW(), INTERVAL 6 MONTH)
  `, [businessId]);
  const totalBefore = (totalBeforeRes as any[])[0].c;

  let cumulative = totalBefore;
  const growthData = (growth as any[]).map((r: any) => {
    cumulative += r.newCount;
    return { month: r.month, total: cumulative };
  });

  const [topCustomers] = await pool.query<any[]>(`
    SELECT c.name, SUM(o.total) AS totalSpent, COUNT(o.id) AS orderCount
    FROM Orders o
    INNER JOIN Customers c ON o.customerId = c.id
    WHERE o.businessId = ?
    GROUP BY c.name
    ORDER BY totalSpent DESC
    LIMIT 10
  `, [businessId]);

  const [avgInterval] = await pool.query<any[]>(`
    SELECT
      DATE_FORMAT(createdAt, '%Y-%m') AS month,
      AVG(TIMESTAMPDIFF(DAY, prevCreatedAt, createdAt)) AS avgDays
    FROM (
      SELECT customerId, createdAt,
        LAG(createdAt) OVER (PARTITION BY customerId ORDER BY createdAt) AS prevCreatedAt
      FROM Orders WHERE businessId = ?
    ) o2
    WHERE prevCreatedAt IS NOT NULL
      AND createdAt >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
    GROUP BY DATE_FORMAT(createdAt, '%Y-%m')
    ORDER BY month ASC
  `, [businessId]);

  const kpiRow = (kpis as any[])[0];
  const nvr = (newVsRecurring as any[])[0];
  const li = (loyaltyIndex as any[])[0];

  return {
    totalCustomers: kpiRow.totalCustomers,
    newCustomersPeriod: kpiRow.newCustomersPeriod,
    recurringCustomers: (recurring as any[])[0].recurringCustomers,
    returnRate: parseFloat((returnRate as any[])[0].returnRate),
    avgCLV: parseFloat((clv as any[])[0].avgCLV),
    newByDay: (newByDay as any[]).map((r: any) => ({ day: r.day, count: r.count })),
    newVsRecurring: {
      newCustomers: nvr.newCustomers || 0,
      recurringCustomers: nvr.recurringCustomers || 0
    },
    loyaltyIndex: {
      oneOrder: li.oneOrder || 0,
      twoThreeOrders: li.twoThreeOrders || 0,
      fourPlusOrders: li.fourPlusOrders || 0
    },
    returnByMonth: (returnByMonth as any[]).map((r: any) => ({ month: r.month, returnRate: parseFloat(r.returnRate) })),
    customerGrowth: growthData,
    topCustomers: (topCustomers as any[]).map((r: any) => ({ name: r.name, totalSpent: parseFloat(r.totalSpent), orderCount: r.orderCount })),
    avgOrderInterval: (avgInterval as any[]).map((r: any) => ({ month: r.month, avgDays: r.avgDays }))
  };
};
