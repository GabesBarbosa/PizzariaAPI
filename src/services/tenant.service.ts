import sql from 'mssql';

/**
 * Provisions a new tenant database with the pizzaria schema.
 * Creates the database and all required tables.
 */
export const provisionTenantDatabase = async (dbName: string) => {
  // Validate dbName to prevent SQL injection (only allow alphanumeric + underscore)
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error('Invalid database name');
  }

  // Connect to master (SQL Server system db) to create the new database
  const adminConfig: sql.config = {
    server: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433,
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    database: 'master',
    options: {
      encrypt: false,
      trustServerCertificate: true,
      instanceName: process.env.DB_INSTANCE || undefined
    }
  };

  const adminPool = new sql.ConnectionPool(adminConfig);
  await adminPool.connect();

  try {
    // Create the database if it doesn't exist
    await adminPool.request().query(
      `IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = '${dbName}')
       CREATE DATABASE [${dbName}]`
    );

    // Wait briefly for database to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Now connect to the new database and create tables
    const tenantConfig: sql.config = {
      ...adminConfig,
      database: dbName
    };
    const tenantPool = new sql.ConnectionPool(tenantConfig);
    await tenantPool.connect();

    try {
      await tenantPool.request().query(`
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Customers')
        CREATE TABLE Customers (
          id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
          name NVARCHAR(200) NOT NULL,
          phone NVARCHAR(50) NOT NULL UNIQUE,
          address NVARCHAR(500) NULL,
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );

        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Products')
        CREATE TABLE Products (
          id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
          name NVARCHAR(200) NOT NULL,
          description NVARCHAR(1000) NULL,
          price DECIMAL(10,2) NOT NULL,
          category NVARCHAR(50) NOT NULL DEFAULT 'outro',
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );

        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Orders')
        CREATE TABLE Orders (
          id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          customerId UNIQUEIDENTIFIER NOT NULL,
          total DECIMAL(12,2) NOT NULL,
          status NVARCHAR(50) NOT NULL DEFAULT 'RECEIVED',
          paymentMethod NVARCHAR(50) NULL,
          deliveryAddress NVARCHAR(500) NULL,
          notes NVARCHAR(1000) NULL,
          deliveryFee DECIMAL(10,2) NULL DEFAULT 0,
          channel NVARCHAR(50) NULL DEFAULT 'balcao',
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          deliveredAt DATETIME2 NULL,
          CONSTRAINT FK_Orders_Customers FOREIGN KEY (customerId) REFERENCES Customers(id)
        );

        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'OrderItems')
        CREATE TABLE OrderItems (
          id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
          orderId INT NOT NULL,
          productId UNIQUEIDENTIFIER NOT NULL,
          quantity INT NOT NULL,
          price DECIMAL(10,2) NOT NULL,
          CONSTRAINT FK_OrderItems_Orders FOREIGN KEY (orderId) REFERENCES Orders(id),
          CONSTRAINT FK_OrderItems_Products FOREIGN KEY (productId) REFERENCES Products(id)
        );
      `);
    } finally {
      await tenantPool.close();
    }
  } finally {
    await adminPool.close();
  }
};
