-- ============================================================
-- Restaurant API - Single Database Schema
-- Run against a fresh Azure SQL database (e.g. RestaurantHub)
-- ============================================================

-- ========================
-- BUSINESSES (replaces Tenants)
-- ========================
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Businesses')
CREATE TABLE Businesses (
  id        UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  name      NVARCHAR(200) NOT NULL,
  slug      NVARCHAR(100) NOT NULL,
  active    BIT NOT NULL DEFAULT 1,
  createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_Businesses_slug UNIQUE (slug)
);

-- ========================
-- USERS
-- ========================
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Users')
CREATE TABLE Users (
  id           UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  businessId   UNIQUEIDENTIFIER NOT NULL REFERENCES Businesses(id),
  name         NVARCHAR(200) NOT NULL,
  email        NVARCHAR(200) NOT NULL,
  passwordHash NVARCHAR(500) NOT NULL,
  role         NVARCHAR(50) NOT NULL DEFAULT 'admin',
  active       BIT NOT NULL DEFAULT 1,
  createdAt    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_Users_email UNIQUE (email)
);

-- ========================
-- CUSTOMERS
-- ========================
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Customers')
CREATE TABLE Customers (
  id         UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  businessId UNIQUEIDENTIFIER NOT NULL,
  name       NVARCHAR(200) NOT NULL,
  phone      NVARCHAR(50) NOT NULL,
  address    NVARCHAR(500) NULL,
  createdAt  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_Customers_business_phone UNIQUE (businessId, phone)
);

-- ========================
-- PRODUCTS
-- ========================
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Products')
CREATE TABLE Products (
  id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  businessId  UNIQUEIDENTIFIER NOT NULL,
  name        NVARCHAR(200) NOT NULL,
  description NVARCHAR(1000) NULL,
  price       DECIMAL(10,2) NOT NULL,
  category    NVARCHAR(50) NOT NULL DEFAULT 'geral',
  createdAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

-- ========================
-- PRODUCT VARIATIONS
-- ========================
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProductVariations')
CREATE TABLE ProductVariations (
  id            UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  productId     UNIQUEIDENTIFIER NOT NULL REFERENCES Products(id),
  businessId    UNIQUEIDENTIFIER NOT NULL,
  name          NVARCHAR(100) NOT NULL,
  type          NVARCHAR(50) NOT NULL DEFAULT 'custom',
  priceModifier DECIMAL(10,2) NOT NULL DEFAULT 0,
  createdAt     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

-- ========================
-- ORDERS
-- ========================
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Orders')
CREATE TABLE Orders (
  id              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  businessId      UNIQUEIDENTIFIER NOT NULL,
  customerId      UNIQUEIDENTIFIER NOT NULL REFERENCES Customers(id),
  total           DECIMAL(12,2) NOT NULL,
  status          NVARCHAR(50) NOT NULL DEFAULT 'RECEIVED',
  paymentMethod   NVARCHAR(50) NULL,
  deliveryAddress NVARCHAR(500) NULL,
  notes           NVARCHAR(1000) NULL,
  deliveryFee     DECIMAL(10,2) NOT NULL DEFAULT 0,
  channel         NVARCHAR(50) NOT NULL DEFAULT 'balcao',
  createdAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  deliveredAt     DATETIME2 NULL
);

-- ========================
-- ORDER ITEMS
-- ========================
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'OrderItems')
CREATE TABLE OrderItems (
  id         UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  orderId    INT NOT NULL REFERENCES Orders(id),
  productId  UNIQUEIDENTIFIER NOT NULL REFERENCES Products(id),
  quantity   INT NOT NULL,
  unitPrice  DECIMAL(10,2) NOT NULL,
  finalPrice DECIMAL(10,2) NOT NULL
);

-- ========================
-- ORDER ITEM VARIATIONS
-- ========================
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'OrderItemVariations')
CREATE TABLE OrderItemVariations (
  id            UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  orderItemId   UNIQUEIDENTIFIER NOT NULL REFERENCES OrderItems(id),
  variationId   UNIQUEIDENTIFIER NOT NULL REFERENCES ProductVariations(id),
  priceModifier DECIMAL(10,2) NOT NULL
);

-- ========================
-- INDEXES
-- ========================
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Customers_BusinessId')
  CREATE INDEX IX_Customers_BusinessId ON Customers(businessId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Products_BusinessId')
  CREATE INDEX IX_Products_BusinessId ON Products(businessId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Orders_BusinessId')
  CREATE INDEX IX_Orders_BusinessId ON Orders(businessId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Orders_CustomerId')
  CREATE INDEX IX_Orders_CustomerId ON Orders(customerId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ProductVariations_ProductId')
  CREATE INDEX IX_ProductVariations_ProductId ON ProductVariations(productId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_OrderItems_OrderId')
  CREATE INDEX IX_OrderItems_OrderId ON OrderItems(orderId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_OrderItemVariations_OrderItemId')
  CREATE INDEX IX_OrderItemVariations_OrderItemId ON OrderItemVariations(orderItemId);
