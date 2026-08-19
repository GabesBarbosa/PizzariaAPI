-- ============================================================
-- Restaurant API - Single Database Schema
-- MySQL version — run against the Railway MySQL database
-- ============================================================

-- ========================
-- BUSINESSES
-- ========================
CREATE TABLE IF NOT EXISTS Businesses (
  id        CHAR(36) NOT NULL PRIMARY KEY,
  name      VARCHAR(200) NOT NULL,
  slug      VARCHAR(100) NOT NULL,
  active    TINYINT(1) NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT UQ_Businesses_slug UNIQUE (slug)
);

-- ========================
-- USERS
-- ========================
CREATE TABLE IF NOT EXISTS Users (
  id           CHAR(36) NOT NULL PRIMARY KEY,
  businessId   CHAR(36) NOT NULL,
  name         VARCHAR(200) NOT NULL,
  email        VARCHAR(200) NOT NULL,
  passwordHash VARCHAR(500) NOT NULL,
  role         VARCHAR(50) NOT NULL DEFAULT 'admin',
  active       TINYINT(1) NOT NULL DEFAULT 1,
  createdAt    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT UQ_Users_email UNIQUE (email),
  CONSTRAINT FK_Users_Businesses FOREIGN KEY (businessId) REFERENCES Businesses(id)
);

-- ========================
-- CUSTOMERS
-- ========================
CREATE TABLE IF NOT EXISTS Customers (
  id           CHAR(36) NOT NULL PRIMARY KEY,
  businessId   CHAR(36) NOT NULL,
  name         VARCHAR(200) NOT NULL,
  phone        VARCHAR(50) NOT NULL,
  address      VARCHAR(500) NULL,
  cep          VARCHAR(9) NULL,
  street       VARCHAR(200) NULL,
  `number`     VARCHAR(20) NULL,
  complement   VARCHAR(200) NULL,
  neighborhood VARCHAR(200) NULL,
  city         VARCHAR(100) NULL,
  uf           VARCHAR(2) NULL,
  latitude     DECIMAL(9,6) NULL,
  longitude    DECIMAL(9,6) NULL,
  createdAt    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT UQ_Customers_business_phone UNIQUE (businessId, phone),
  CONSTRAINT FK_Customers_Businesses FOREIGN KEY (businessId) REFERENCES Businesses(id)
);

-- ========================
-- PRODUCTS
-- ========================
CREATE TABLE IF NOT EXISTS Products (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  businessId  CHAR(36) NOT NULL,
  name        VARCHAR(200) NOT NULL,
  description VARCHAR(1000) NULL,
  price       DECIMAL(10,2) NOT NULL,
  category    VARCHAR(50) NOT NULL DEFAULT 'geral',
  imageBase64 LONGTEXT NULL,
  -- NULL = produto sem controle de estoque (sempre disponível); 0 = esgotado
  stockQuantity INT NULL,
  createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT FK_Products_Businesses FOREIGN KEY (businessId) REFERENCES Businesses(id)
);

-- ========================
-- PRODUCT VARIATIONS
-- ========================
CREATE TABLE IF NOT EXISTS ProductVariations (
  id            CHAR(36) NOT NULL PRIMARY KEY,
  productId     CHAR(36) NOT NULL,
  businessId    CHAR(36) NOT NULL,
  name          VARCHAR(100) NOT NULL,
  type          VARCHAR(50) NOT NULL DEFAULT 'custom',
  priceModifier DECIMAL(10,2) NOT NULL DEFAULT 0,
  createdAt     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT FK_ProductVariations_Products FOREIGN KEY (productId) REFERENCES Products(id),
  CONSTRAINT FK_ProductVariations_Businesses FOREIGN KEY (businessId) REFERENCES Businesses(id)
);

-- ========================
-- ORDERS
-- ========================
CREATE TABLE IF NOT EXISTS Orders (
  id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  businessId      CHAR(36) NOT NULL,
  customerId      CHAR(36) NULL,
  total           DECIMAL(12,2) NOT NULL,
  status          VARCHAR(50) NOT NULL DEFAULT 'RECEIVED',
  paymentMethod   VARCHAR(50) NULL,
  deliveryAddress VARCHAR(500) NULL,
  notes           VARCHAR(1000) NULL,
  deliveryFee     DECIMAL(10,2) NOT NULL DEFAULT 0,
  channel         VARCHAR(50) NOT NULL DEFAULT 'balcao',
  tableNumber     INT NULL,
  createdAt       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deliveredAt     DATETIME NULL,
  CONSTRAINT FK_Orders_Businesses FOREIGN KEY (businessId) REFERENCES Businesses(id),
  CONSTRAINT FK_Orders_Customers FOREIGN KEY (customerId) REFERENCES Customers(id)
);

-- ========================
-- ORDER ITEMS
-- ========================
CREATE TABLE IF NOT EXISTS OrderItems (
  id         CHAR(36) NOT NULL PRIMARY KEY,
  orderId    INT NOT NULL,
  productId  CHAR(36) NULL,
  quantity   INT NOT NULL,
  unitPrice  DECIMAL(10,2) NOT NULL,
  finalPrice DECIMAL(10,2) NOT NULL,
  CONSTRAINT FK_OrderItems_Orders FOREIGN KEY (orderId) REFERENCES Orders(id),
  CONSTRAINT FK_OrderItems_Products FOREIGN KEY (productId) REFERENCES Products(id)
);

-- ========================
-- ORDER ITEM VARIATIONS
-- ========================
CREATE TABLE IF NOT EXISTS OrderItemVariations (
  id            CHAR(36) NOT NULL PRIMARY KEY,
  orderItemId   CHAR(36) NOT NULL,
  variationId   CHAR(36) NOT NULL,
  priceModifier DECIMAL(10,2) NOT NULL,
  CONSTRAINT FK_OrderItemVariations_OrderItems FOREIGN KEY (orderItemId) REFERENCES OrderItems(id),
  CONSTRAINT FK_OrderItemVariations_ProductVariations FOREIGN KEY (variationId) REFERENCES ProductVariations(id)
);

-- ========================
-- SETTINGS
-- ========================
CREATE TABLE IF NOT EXISTS Settings (
  businessId CHAR(36) NOT NULL,
  `key`      VARCHAR(100) NOT NULL,
  value      VARCHAR(2000) NOT NULL,
  updatedAt  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (businessId, `key`)
);

-- ========================
-- INDEXES
-- ========================
CREATE INDEX IX_Users_BusinessId ON Users(businessId);
CREATE INDEX IX_Customers_BusinessId ON Customers(businessId);
CREATE INDEX IX_Products_BusinessId ON Products(businessId);
CREATE INDEX IX_Orders_BusinessId ON Orders(businessId);
CREATE INDEX IX_Orders_CustomerId ON Orders(customerId);
CREATE INDEX IX_ProductVariations_ProductId ON ProductVariations(productId);
CREATE INDEX IX_OrderItems_OrderId ON OrderItems(orderId);
CREATE INDEX IX_OrderItemVariations_OrderItemId ON OrderItemVariations(orderItemId);
