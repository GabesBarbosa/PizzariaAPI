# Restaurant API Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor PizzariaAPI into a generic restaurant SaaS platform using a single Azure SQL database with `businessId` row-level isolation, replacing the separate-database-per-tenant architecture.

**Architecture:** All tenant data (Customers, Products, Orders) lives in one database, isolated by a `businessId` column on every row. A singleton connection pool replaces the `Map<dbName, Pool>` pattern. Business context is propagated via `AsyncLocalStorage` (same mechanism as before, minus `dbName`). Product variations replace pizza-specific size/half logic.

**Tech Stack:** Node.js, TypeScript, Express, mssql (SQL Server driver), jsonwebtoken, bcryptjs, Azure SQL Database.

> **Note:** This project has no test framework configured. Each task verifies correctness via TypeScript compilation (`npx tsc --noEmit`) and manual API smoke tests where noted.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `database/init.sql` | Rewrite | Full schema: Businesses, Users, Customers, Products, ProductVariations, Orders, OrderItems, OrderItemVariations + indexes |
| `src/database/businessContext.ts` | Create (replaces `tenantContext.ts`) | AsyncLocalStorage for businessId/userId/role |
| `src/database/mssqlClient.ts` | Modify | Singleton pool, no more Map |
| `src/database/masterDb.ts` | Delete | Merged into single DB / single pool |
| `src/database/tenantContext.ts` | Delete | Replaced by businessContext.ts |
| `src/dtos/auth.dto.ts` | Modify | tenantName→businessName, tenantSlug→businessSlug, remove dbName |
| `src/dtos/product.dto.ts` | Modify | Add variation DTOs |
| `src/dtos/order.dto.ts` | Modify | Replace size/halfProductId with variations array |
| `src/models/entities/Product.ts` | Modify | Add variations field |
| `src/models/entities/Order.ts` | Modify | Update OrderItem shape |
| `src/models/entities/ProductVariation.ts` | Create | ProductVariation interface |
| `src/models/entities/OrderItemVariation.ts` | Create | OrderItemVariation interface |
| `src/middlewares/auth.middleware.ts` | Modify | Use businessStorage, new AuthPayload shape |
| `src/repositories/auth.repository.ts` | Modify | Use getPool(), Businesses table, remove dbName |
| `src/repositories/customer.repository.ts` | Modify | Add businessId filter to all queries |
| `src/repositories/product.repository.ts` | Modify | Add businessId filter + variation queries |
| `src/repositories/order.repository.ts` | Modify | Add businessId filter, remove pizza logic, add variations |
| `src/repositories/dashboard.repository.ts` | Modify | Add businessId filter to all queries |
| `src/services/auth.service.ts` | Modify | Remove dbName/provisionTenantDatabase, use businessId |
| `src/services/business.service.ts` | Create (replaces `tenant.service.ts`) | registerBusiness() — DB insert only |
| `src/services/tenant.service.ts` | Delete | Replaced by business.service.ts |
| `src/services/order.service.ts` | Modify | Remove pizza-specific WhatsApp text + loyalty card |
| `src/services/whatsapp.service.ts` | Modify | Use businessStorage instead of tenantStorage |
| `src/controllers/product.controller.ts` | Modify | Add variation CRUD handlers |
| `src/routes/product.routes.ts` | Modify | Add variation routes under /:id/variations |
| `package.json` | Modify | Rename pizzaria-api → restaurant-api |
| `src/scripts/seed-master.ts` | Modify | Update for Businesses table, remove dbName |
| `src/scripts/migrate-azure.ts` | Delete | No longer needed |

---

## Task 1: Rewrite database/init.sql

**Files:**
- Modify: `database/init.sql`

- [ ] **Step 1: Rewrite init.sql with the new schema**

Replace the entire contents of `database/init.sql` with:

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add database/init.sql
git commit -m "feat: rewrite init.sql for single-db multi-tenant schema with variations"
```

---

## Task 2: Business context + singleton pool

**Files:**
- Create: `src/database/businessContext.ts`
- Modify: `src/database/mssqlClient.ts`
- Delete: `src/database/masterDb.ts`
- Delete: `src/database/tenantContext.ts`

- [ ] **Step 1: Create `src/database/businessContext.ts`**

```typescript
import { AsyncLocalStorage } from 'async_hooks';

export interface BusinessContext {
  businessId: string;
  userId: string;
  role: string;
}

export const businessStorage = new AsyncLocalStorage<BusinessContext>();

export const getBusinessContext = (): BusinessContext | undefined => {
  return businessStorage.getStore();
};
```

- [ ] **Step 2: Rewrite `src/database/mssqlClient.ts` as singleton pool**

```typescript
import sql from 'mssql';

const config: sql.config = {
  server: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433,
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'RestaurantHub',
  requestTimeout: 60000,
  connectionTimeout: 60000,
  options: {
    encrypt: true,
    trustServerCertificate: false,
    connectTimeout: 60000
  }
};

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export const getPool = async (): Promise<sql.ConnectionPool> => {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(config);
    poolPromise = pool.connect().then(() => pool).catch((err) => {
      poolPromise = null;
      const e: any = new Error('Failed to connect to database');
      e.original = err;
      throw e;
    });
  }
  return poolPromise;
};

export { sql };
```

- [ ] **Step 3: Delete `src/database/masterDb.ts` and `src/database/tenantContext.ts`**

```bash
rm src/database/masterDb.ts
rm src/database/tenantContext.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/database/businessContext.ts src/database/mssqlClient.ts
git rm src/database/masterDb.ts src/database/tenantContext.ts
git commit -m "feat: replace tenant pool map with singleton pool and business context"
```

---

## Task 3: Update DTOs

**Files:**
- Modify: `src/dtos/auth.dto.ts`
- Modify: `src/dtos/product.dto.ts`
- Modify: `src/dtos/order.dto.ts`

- [ ] **Step 1: Rewrite `src/dtos/auth.dto.ts`**

```typescript
export interface LoginDTO {
  email: string;
  password: string;
}

export interface RegisterDTO {
  name: string;
  email: string;
  password: string;
  businessName: string;  // Nome do restaurante
  businessSlug: string;  // Slug único (ex: 'burger-joao', 'cantina-napoli')
}
```

- [ ] **Step 2: Rewrite `src/dtos/product.dto.ts`**

```typescript
export interface CreateProductDTO {
  name: string;
  description?: string;
  price: number;
  category?: string;
}

export interface UpdateProductDTO {
  name?: string;
  description?: string;
  price?: number;
  category?: string;
}

export interface CreateVariationDTO {
  name: string;
  type: 'size' | 'addon' | 'removal' | 'custom';
  priceModifier: number;
}

export interface UpdateVariationDTO {
  name?: string;
  type?: 'size' | 'addon' | 'removal' | 'custom';
  priceModifier?: number;
}
```

- [ ] **Step 3: Rewrite `src/dtos/order.dto.ts`**

```typescript
export interface OrderItemVariationDTO {
  variationId: string;
}

export interface CreateOrderItemDTO {
  productId: string;
  quantity: number;
  variations?: OrderItemVariationDTO[];
}

export interface CreateOrderDTO {
  customerId: string;
  items: CreateOrderItemDTO[];
  paymentMethod?: string;
  deliveryAddress?: string;
  notes?: string;
  deliveryFee?: number;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/dtos/auth.dto.ts src/dtos/product.dto.ts src/dtos/order.dto.ts
git commit -m "feat: update DTOs — businessId, remove pizza fields, add variations"
```

---

## Task 4: Update models/entities

**Files:**
- Create: `src/models/entities/ProductVariation.ts`
- Create: `src/models/entities/OrderItemVariation.ts`
- Modify: `src/models/entities/Product.ts`
- Modify: `src/models/entities/Order.ts`

- [ ] **Step 1: Create `src/models/entities/ProductVariation.ts`**

```typescript
export interface ProductVariation {
  id: string;
  productId: string;
  businessId: string;
  name: string;
  type: 'size' | 'addon' | 'removal' | 'custom';
  priceModifier: number;
  createdAt?: Date;
}
```

- [ ] **Step 2: Create `src/models/entities/OrderItemVariation.ts`**

```typescript
export interface OrderItemVariation {
  id: string;
  orderItemId: string;
  variationId: string;
  priceModifier: number;
}
```

- [ ] **Step 3: Rewrite `src/models/entities/Product.ts`**

```typescript
import { ProductVariation } from './ProductVariation';

export interface Product {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  price: number;
  category: string;
  createdAt?: Date;
  variations?: ProductVariation[];
}
```

- [ ] **Step 4: Rewrite `src/models/entities/Order.ts`**

```typescript
import { OrderItemVariation } from './OrderItemVariation';

export interface OrderItem {
  id: string;
  orderId: number;
  productId: string;
  quantity: number;
  unitPrice: number;
  finalPrice: number;
  variations?: OrderItemVariation[];
}

export interface Order {
  id: number;
  businessId: string;
  customerId: string;
  items: OrderItem[];
  total: number;
  status: string;
  paymentMethod?: string;
  deliveryAddress?: string;
  notes?: string;
  deliveryFee: number;
  channel: string;
  createdAt?: Date;
  deliveredAt?: Date;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/models/entities/
git commit -m "feat: update entity models — remove pizza fields, add variation models"
```

---

## Task 5: Update auth middleware + auth repository + auth service

**Files:**
- Modify: `src/middlewares/auth.middleware.ts`
- Modify: `src/repositories/auth.repository.ts`
- Modify: `src/services/auth.service.ts`

- [ ] **Step 1: Rewrite `src/middlewares/auth.middleware.ts`**

```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { businessStorage } from '../database/businessContext';
import { getJwtSecret } from '../services/auth.service';

export interface AuthPayload {
  userId: string;
  businessId: string;
  role: string;
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  let token: string | undefined;

  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (typeof req.query.token === 'string' && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ message: 'Token não fornecido' });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as AuthPayload;

    (req as any).user = {
      userId: payload.userId,
      businessId: payload.businessId,
      role: payload.role
    };

    businessStorage.run(
      { businessId: payload.businessId, userId: payload.userId, role: payload.role },
      () => next()
    );
  } catch (err) {
    return res.status(401).json({ message: 'Token inválido ou expirado' });
  }
};
```

- [ ] **Step 2: Rewrite `src/repositories/auth.repository.ts`**

```typescript
import { getPool, sql } from '../database/mssqlClient';

export const findUserByEmail = async (email: string) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('email', sql.NVarChar(200), email);
  const result = await req.query(`
    SELECT u.*, b.name AS businessName, b.slug AS businessSlug, b.active AS businessActive
    FROM Users u
    INNER JOIN Businesses b ON u.businessId = b.id
    WHERE u.email = @email
  `);
  return result.recordset[0];
};

export const findBusinessBySlug = async (slug: string) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('slug', sql.NVarChar(100), slug);
  const result = await req.query('SELECT * FROM Businesses WHERE slug = @slug');
  return result.recordset[0];
};

export const createBusiness = async (name: string, slug: string) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('name', sql.NVarChar(200), name);
  req.input('slug', sql.NVarChar(100), slug);
  const result = await req.query(
    `INSERT INTO Businesses (name, slug)
     OUTPUT inserted.*
     VALUES (@name, @slug)`
  );
  return result.recordset[0];
};

export const createUser = async (businessId: string, name: string, email: string, passwordHash: string) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('businessId', sql.UniqueIdentifier, businessId);
  req.input('name', sql.NVarChar(200), name);
  req.input('email', sql.NVarChar(200), email);
  req.input('passwordHash', sql.NVarChar(500), passwordHash);
  const result = await req.query(
    `INSERT INTO Users (businessId, name, email, passwordHash)
     OUTPUT inserted.id, inserted.businessId, inserted.name, inserted.email, inserted.role
     VALUES (@businessId, @name, @email, @passwordHash)`
  );
  return result.recordset[0];
};

export const findUserById = async (id: string) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('id', sql.UniqueIdentifier, id);
  const result = await req.query(`
    SELECT u.id, u.name, u.email, u.role, u.businessId, u.passwordHash,
           b.name AS businessName, b.slug AS businessSlug
    FROM Users u
    INNER JOIN Businesses b ON u.businessId = b.id
    WHERE u.id = @id
  `);
  return result.recordset[0];
};

export const updateUser = async (id: string, data: { name?: string; email?: string; passwordHash?: string }) => {
  const conn = await getPool();
  const req = conn.request();
  req.input('id', sql.UniqueIdentifier, id);
  req.input('name', sql.NVarChar(200), data.name || null);
  req.input('email', sql.NVarChar(200), data.email || null);
  req.input('passwordHash', sql.NVarChar(500), data.passwordHash || null);
  const result = await req.query(
    `UPDATE Users SET
       name = COALESCE(@name, name),
       email = COALESCE(@email, email),
       passwordHash = COALESCE(@passwordHash, passwordHash)
     OUTPUT inserted.id, inserted.name, inserted.email, inserted.role
     WHERE id = @id`
  );
  return result.recordset[0];
};
```

- [ ] **Step 3: Rewrite `src/services/auth.service.ts`**

```typescript
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as authRepo from '../repositories/auth.repository';
import { LoginDTO, RegisterDTO } from '../dtos/auth.dto';

const JWT_SECRET = process.env.JWT_SECRET || 'restaurant-secret-change-me';
const JWT_EXPIRES = '24h';

export const login = async (data: LoginDTO) => {
  const user = await authRepo.findUserByEmail(data.email);
  if (!user) throw Object.assign(new Error('E-mail ou senha inválidos'), { status: 401 });
  if (!user.active) throw Object.assign(new Error('Usuário desativado'), { status: 403 });
  if (!user.businessActive) throw Object.assign(new Error('Estabelecimento desativado'), { status: 403 });

  const valid = await bcrypt.compare(data.password, user.passwordHash);
  if (!valid) throw Object.assign(new Error('E-mail ou senha inválidos'), { status: 401 });

  const token = jwt.sign(
    { userId: user.id, businessId: user.businessId, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      businessName: user.businessName,
      businessSlug: user.businessSlug
    }
  };
};

export const register = async (data: RegisterDTO) => {
  const existing = await authRepo.findBusinessBySlug(data.businessSlug);
  if (existing) throw Object.assign(new Error('Slug do estabelecimento já está em uso'), { status: 409 });

  const existingUser = await authRepo.findUserByEmail(data.email);
  if (existingUser) throw Object.assign(new Error('E-mail já cadastrado'), { status: 409 });

  const business = await authRepo.createBusiness(data.businessName, data.businessSlug);

  const passwordHash = await bcrypt.hash(data.password, 10);
  const user = await authRepo.createUser(business.id, data.name, data.email, passwordHash);

  const token = jwt.sign(
    { userId: user.id, businessId: business.id, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      businessName: data.businessName,
      businessSlug: data.businessSlug
    }
  };
};

export const updateProfile = async (userId: string, data: { name?: string; email?: string; currentPassword?: string; newPassword?: string }) => {
  const user = await authRepo.findUserById(userId);
  if (!user) throw Object.assign(new Error('Usuário não encontrado'), { status: 404 });

  if (data.newPassword) {
    if (!data.currentPassword) throw Object.assign(new Error('Senha atual é obrigatória'), { status: 400 });
    const valid = await bcrypt.compare(data.currentPassword, user.passwordHash);
    if (!valid) throw Object.assign(new Error('Senha atual incorreta'), { status: 400 });
  }

  if (data.email && data.email !== user.email) {
    const existing = await authRepo.findUserByEmail(data.email);
    if (existing) throw Object.assign(new Error('E-mail já está em uso'), { status: 409 });
  }

  const updateData: { name?: string; email?: string; passwordHash?: string } = {};
  if (data.name) updateData.name = data.name;
  if (data.email) updateData.email = data.email;
  if (data.newPassword) updateData.passwordHash = await bcrypt.hash(data.newPassword, 10);

  const updated = await authRepo.updateUser(userId, updateData);

  const token = jwt.sign(
    { userId: updated.id, businessId: user.businessId, role: updated.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );

  return {
    token,
    user: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      businessName: user.businessName,
      businessSlug: user.businessSlug
    }
  };
};

export const getJwtSecret = () => JWT_SECRET;
```

- [ ] **Step 4: Delete `src/services/tenant.service.ts`**

```bash
rm src/services/tenant.service.ts
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: errors only in files not yet updated (customer/product/order repositories). No errors in the files edited in this task.

- [ ] **Step 6: Commit**

```bash
git add src/middlewares/auth.middleware.ts src/repositories/auth.repository.ts src/services/auth.service.ts
git rm src/services/tenant.service.ts
git commit -m "feat: auth layer — businessId context, remove dbName and DB provisioning"
```

---

## Task 6: Update customer repository

**Files:**
- Modify: `src/repositories/customer.repository.ts`

- [ ] **Step 1: Rewrite `src/repositories/customer.repository.ts`**

```typescript
import { getPool, sql } from '../database/mssqlClient';
import { getBusinessContext } from '../database/businessContext';
import { CreateCustomerDTO, UpdateCustomerDTO } from '../dtos/customer.dto';

export const getAllCustomers = async () => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const req = conn.request();
  req.input('businessId', sql.UniqueIdentifier, businessId);
  const result = await req.query('SELECT * FROM Customers WHERE businessId = @businessId ORDER BY name');
  return result.recordset;
};

export const createCustomer = async (data: CreateCustomerDTO) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const request = conn.request();
  request.input('businessId', sql.UniqueIdentifier, businessId);
  request.input('name', sql.NVarChar(200), data.name);
  request.input('phone', sql.NVarChar(50), data.phone);
  request.input('address', sql.NVarChar(500), data.address || null);
  const result = await request.query(
    `INSERT INTO Customers (businessId, name, phone, address)
     OUTPUT inserted.*
     VALUES (@businessId, @name, @phone, @address)`
  );
  return result.recordset[0];
};

export const findCustomerById = async (id: string) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const request = conn.request();
  request.input('id', sql.UniqueIdentifier, id);
  request.input('businessId', sql.UniqueIdentifier, businessId);
  const result = await request.query(
    `SELECT * FROM Customers WHERE id = @id AND businessId = @businessId`
  );
  return result.recordset[0];
};

export const findCustomersByNameOrPhone = async (term: string) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const request = conn.request();
  const like = `%${term}%`;
  request.input('term', sql.NVarChar(200), like);
  request.input('businessId', sql.UniqueIdentifier, businessId);
  const result = await request.query(
    `SELECT * FROM Customers WHERE businessId = @businessId AND (name LIKE @term OR phone LIKE @term)`
  );
  return result.recordset;
};

export const updateCustomer = async (id: string, data: UpdateCustomerDTO) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const request = conn.request();
  request.input('id', sql.UniqueIdentifier, id);
  request.input('businessId', sql.UniqueIdentifier, businessId);
  request.input('name', sql.NVarChar(200), data.name || null);
  request.input('phone', sql.NVarChar(50), data.phone || null);
  request.input('address', sql.NVarChar(500), data.address || null);
  const result = await request.query(
    `UPDATE Customers SET
       name = COALESCE(@name, name),
       phone = COALESCE(@phone, phone),
       address = COALESCE(@address, address)
     OUTPUT inserted.*
     WHERE id = @id AND businessId = @businessId`
  );
  return result.recordset[0];
};

export const deleteCustomer = async (id: string) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const request = conn.request();
  request.input('id', sql.UniqueIdentifier, id);
  request.input('businessId', sql.UniqueIdentifier, businessId);
  await request.query('DELETE FROM Customers WHERE id = @id AND businessId = @businessId');
};
```

- [ ] **Step 2: Commit**

```bash
git add src/repositories/customer.repository.ts
git commit -m "feat: customer repository — add businessId isolation"
```

---

## Task 7: Update product repository + add variation queries

**Files:**
- Modify: `src/repositories/product.repository.ts`

- [ ] **Step 1: Rewrite `src/repositories/product.repository.ts`**

```typescript
import { getPool, sql } from '../database/mssqlClient';
import { getBusinessContext } from '../database/businessContext';
import { CreateProductDTO, UpdateProductDTO, CreateVariationDTO, UpdateVariationDTO } from '../dtos/product.dto';
import { v4 as uuidv4 } from 'uuid';

export const getAllProducts = async () => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const req = pool.request();
  req.input('businessId', sql.UniqueIdentifier, businessId);
  const res = await req.query(
    'SELECT * FROM Products WHERE businessId = @businessId ORDER BY createdAt DESC'
  );
  return res.recordset;
};

export const getProductById = async (id: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, id);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  const res = await req.query(
    'SELECT * FROM Products WHERE id = @id AND businessId = @businessId'
  );
  return res.recordset[0];
};

export const createProduct = async (data: CreateProductDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const id = uuidv4();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, id);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  req.input('name', sql.NVarChar(200), data.name);
  req.input('description', sql.NVarChar(1000), data.description || null);
  req.input('price', sql.Decimal(10, 2), data.price);
  req.input('category', sql.NVarChar(50), data.category || 'geral');
  const res = await req.query(
    `INSERT INTO Products (id, businessId, name, description, price, category)
     OUTPUT inserted.*
     VALUES (@id, @businessId, @name, @description, @price, @category)`
  );
  return res.recordset[0];
};

export const updateProduct = async (id: string, data: UpdateProductDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, id);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  req.input('name', sql.NVarChar(200), data.name || null);
  req.input('description', sql.NVarChar(1000), data.description ?? null);
  req.input('price', sql.Decimal(10, 2), data.price || null);
  req.input('category', sql.NVarChar(50), data.category || null);
  const res = await req.query(
    `UPDATE Products SET
       name = COALESCE(@name, name),
       description = @description,
       price = COALESCE(@price, price),
       category = COALESCE(@category, category)
     OUTPUT inserted.*
     WHERE id = @id AND businessId = @businessId`
  );
  return res.recordset[0];
};

export const deleteProduct = async (id: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, id);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  await req.query('DELETE FROM Products WHERE id = @id AND businessId = @businessId');
};

// ---- Variations ----

export const getVariationsByProduct = async (productId: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const req = pool.request();
  req.input('productId', sql.UniqueIdentifier, productId);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  const res = await req.query(
    `SELECT * FROM ProductVariations
     WHERE productId = @productId AND businessId = @businessId
     ORDER BY createdAt ASC`
  );
  return res.recordset;
};

export const createVariation = async (productId: string, data: CreateVariationDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const id = uuidv4();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, id);
  req.input('productId', sql.UniqueIdentifier, productId);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  req.input('name', sql.NVarChar(100), data.name);
  req.input('type', sql.NVarChar(50), data.type);
  req.input('priceModifier', sql.Decimal(10, 2), data.priceModifier);
  const res = await req.query(
    `INSERT INTO ProductVariations (id, productId, businessId, name, type, priceModifier)
     OUTPUT inserted.*
     VALUES (@id, @productId, @businessId, @name, @type, @priceModifier)`
  );
  return res.recordset[0];
};

export const updateVariation = async (variationId: string, data: UpdateVariationDTO) => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, variationId);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  req.input('name', sql.NVarChar(100), data.name || null);
  req.input('type', sql.NVarChar(50), data.type || null);
  req.input('priceModifier', sql.Decimal(10, 2), data.priceModifier ?? null);
  const res = await req.query(
    `UPDATE ProductVariations SET
       name = COALESCE(@name, name),
       type = COALESCE(@type, type),
       priceModifier = COALESCE(@priceModifier, priceModifier)
     OUTPUT inserted.*
     WHERE id = @id AND businessId = @businessId`
  );
  return res.recordset[0];
};

export const deleteVariation = async (variationId: string) => {
  const { businessId } = getBusinessContext()!;
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.UniqueIdentifier, variationId);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  await req.query(
    'DELETE FROM ProductVariations WHERE id = @id AND businessId = @businessId'
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add src/repositories/product.repository.ts
git commit -m "feat: product repository — businessId isolation + variation CRUD"
```

---

## Task 8: Update order repository

**Files:**
- Modify: `src/repositories/order.repository.ts`

- [ ] **Step 1: Rewrite `src/repositories/order.repository.ts`**

```typescript
import { getPool, sql } from '../database/mssqlClient';
import { getBusinessContext } from '../database/businessContext';
import { CreateOrderDTO, CreateOrderItemDTO } from '../dtos/order.dto';
import { v4 as uuidv4 } from 'uuid';

interface ItemWithPrice {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  finalPrice: number;
  variations: Array<{ variationId: string; priceModifier: number }>;
}

async function calcItemPrice(
  transaction: any,
  it: CreateOrderItemDTO
): Promise<ItemWithPrice> {
  const req1 = new sql.Request(transaction);
  const r1 = await req1
    .input('pid', sql.UniqueIdentifier, it.productId)
    .query('SELECT price FROM Products WHERE id = @pid');
  if (!r1.recordset[0]) throw new Error('Produto não encontrado: ' + it.productId);

  const unitPrice = parseFloat(r1.recordset[0].price);
  let variationTotal = 0;
  const variationSnapshots: Array<{ variationId: string; priceModifier: number }> = [];

  if (it.variations?.length) {
    for (const v of it.variations) {
      const vReq = new sql.Request(transaction);
      const vRes = await vReq
        .input('vid', sql.UniqueIdentifier, v.variationId)
        .query('SELECT priceModifier FROM ProductVariations WHERE id = @vid');
      if (!vRes.recordset[0]) throw new Error('Variação não encontrada: ' + v.variationId);
      const modifier = parseFloat(vRes.recordset[0].priceModifier);
      variationTotal += modifier;
      variationSnapshots.push({ variationId: v.variationId, priceModifier: modifier });
    }
  }

  const finalPrice = Math.round((unitPrice + variationTotal) * 100) / 100;

  return {
    id: uuidv4(),
    productId: it.productId,
    quantity: it.quantity,
    unitPrice,
    finalPrice,
    variations: variationSnapshots
  };
}

async function insertItems(transaction: any, orderId: number, items: ItemWithPrice[]) {
  for (const it of items) {
    const req = new sql.Request(transaction);
    await req
      .input('iid', sql.UniqueIdentifier, it.id)
      .input('oid', sql.Int, orderId)
      .input('pid', sql.UniqueIdentifier, it.productId)
      .input('quantity', sql.Int, it.quantity)
      .input('unitPrice', sql.Decimal(10, 2), it.unitPrice)
      .input('finalPrice', sql.Decimal(10, 2), it.finalPrice)
      .query(
        `INSERT INTO OrderItems (id, orderId, productId, quantity, unitPrice, finalPrice)
         VALUES (@iid, @oid, @pid, @quantity, @unitPrice, @finalPrice)`
      );

    for (const v of it.variations) {
      const vReq = new sql.Request(transaction);
      await vReq
        .input('id', sql.UniqueIdentifier, uuidv4())
        .input('orderItemId', sql.UniqueIdentifier, it.id)
        .input('variationId', sql.UniqueIdentifier, v.variationId)
        .input('priceModifier', sql.Decimal(10, 2), v.priceModifier)
        .query(
          `INSERT INTO OrderItemVariations (id, orderItemId, variationId, priceModifier)
           VALUES (@id, @orderItemId, @variationId, @priceModifier)`
        );
    }
  }
}

export const createOrder = async (data: CreateOrderDTO) => {
  const { businessId } = getBusinessContext()!;
  const connection = await getPool();
  const transaction = new sql.Transaction(connection);
  try {
    await transaction.begin();

    let itemsTotal = 0;
    const itemsWithPrice: ItemWithPrice[] = [];
    for (const it of data.items) {
      const item = await calcItemPrice(transaction, it);
      itemsWithPrice.push(item);
      itemsTotal += item.finalPrice * it.quantity;
    }

    const deliveryFee = data.deliveryFee || 0;
    const grandTotal = Math.round((itemsTotal + deliveryFee) * 100) / 100;

    const orderReq = new sql.Request(transaction as any);
    const orderInsert = await orderReq
      .input('businessId', sql.UniqueIdentifier, businessId)
      .input('customerId', sql.UniqueIdentifier, data.customerId)
      .input('total', sql.Decimal(12, 2), grandTotal)
      .input('paymentMethod', sql.NVarChar(50), data.paymentMethod || null)
      .input('deliveryAddress', sql.NVarChar(500), data.deliveryAddress || null)
      .input('notes', sql.NVarChar(1000), data.notes || null)
      .input('deliveryFee', sql.Decimal(10, 2), deliveryFee)
      .query(
        `INSERT INTO Orders (businessId, customerId, total, status, paymentMethod, deliveryAddress, notes, deliveryFee)
         OUTPUT inserted.id
         VALUES (@businessId, @customerId, @total, 'RECEIVED', @paymentMethod, @deliveryAddress, @notes, @deliveryFee)`
      );
    const orderId: number = orderInsert.recordset[0].id;

    await insertItems(transaction as any, orderId, itemsWithPrice);
    await transaction.commit();

    return findOrderById(orderId);
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* ignore */ }
    throw err;
  }
};

export const findAllOrders = async () => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const req = conn.request();
  req.input('businessId', sql.UniqueIdentifier, businessId);
  const result = await req.query(`
    SELECT o.*, c.name AS customerName
    FROM Orders o
    LEFT JOIN Customers c ON o.customerId = c.id
    WHERE o.businessId = @businessId
    ORDER BY o.createdAt DESC
  `);
  return result.recordset;
};

export const findOrdersByCustomer = async (customerId: string) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const req = conn.request();
  req.input('customerId', sql.UniqueIdentifier, customerId);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  const orders = await req.query(
    'SELECT * FROM Orders WHERE customerId = @customerId AND businessId = @businessId ORDER BY createdAt DESC'
  );
  return orders.recordset;
};

export const findOrderById = async (orderId: number) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const req = conn.request();
  req.input('id', sql.Int, orderId);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  const orderRes = await req.query(`
    SELECT o.*, c.name AS customerName
    FROM Orders o
    LEFT JOIN Customers c ON o.customerId = c.id
    WHERE o.id = @id AND o.businessId = @businessId
  `);
  if (!orderRes.recordset[0]) return null;

  const itemsReq = conn.request();
  itemsReq.input('oid', sql.Int, orderId);
  const itemsRes = await itemsReq.query(`
    SELECT oi.*, p.name AS productName
    FROM OrderItems oi
    LEFT JOIN Products p ON oi.productId = p.id
    WHERE oi.orderId = @oid
  `);

  const items = itemsRes.recordset;

  for (const item of items) {
    const vReq = conn.request();
    vReq.input('orderItemId', sql.UniqueIdentifier, item.id);
    const vRes = await vReq.query(`
      SELECT oiv.*, pv.name AS variationName, pv.type AS variationType
      FROM OrderItemVariations oiv
      LEFT JOIN ProductVariations pv ON oiv.variationId = pv.id
      WHERE oiv.orderItemId = @orderItemId
    `);
    item.variations = vRes.recordset;
  }

  return { ...orderRes.recordset[0], items };
};

export const updateOrderStatus = async (orderId: number, status: string) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const req = conn.request();
  req.input('id', sql.Int, orderId);
  req.input('status', sql.NVarChar(50), status);
  req.input('businessId', sql.UniqueIdentifier, businessId);
  const query = status === 'DELIVERED'
    ? `UPDATE Orders SET status = @status, deliveredAt = SYSUTCDATETIME() OUTPUT inserted.* WHERE id = @id AND businessId = @businessId`
    : `UPDATE Orders SET status = @status OUTPUT inserted.* WHERE id = @id AND businessId = @businessId`;
  const res = await req.query(query);
  return res.recordset[0];
};

export const deleteOrder = async (orderId: number) => {
  const { businessId } = getBusinessContext()!;
  const connection = await getPool();
  const transaction = new sql.Transaction(connection);
  try {
    await transaction.begin();

    // Delete OrderItemVariations first
    const oivReq = new sql.Request(transaction as any);
    await oivReq.input('oid', sql.Int, orderId).query(`
      DELETE oiv FROM OrderItemVariations oiv
      INNER JOIN OrderItems oi ON oiv.orderItemId = oi.id
      WHERE oi.orderId = @oid
    `);

    const itemsReq = new sql.Request(transaction as any);
    await itemsReq.input('oid', sql.Int, orderId)
      .query('DELETE FROM OrderItems WHERE orderId = @oid');

    const orderReq = new sql.Request(transaction as any);
    const res = await orderReq
      .input('id', sql.Int, orderId)
      .input('businessId', sql.UniqueIdentifier, businessId)
      .query('DELETE FROM Orders WHERE id = @id AND businessId = @businessId');

    await transaction.commit();
    return res.rowsAffected[0] > 0;
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* ignore */ }
    throw err;
  }
};

export const updateOrder = async (orderId: number, data: CreateOrderDTO) => {
  const { businessId } = getBusinessContext()!;
  const connection = await getPool();
  const transaction = new sql.Transaction(connection);
  try {
    await transaction.begin();

    // Delete old variations and items
    const oivReq = new sql.Request(transaction as any);
    await oivReq.input('oid', sql.Int, orderId).query(`
      DELETE oiv FROM OrderItemVariations oiv
      INNER JOIN OrderItems oi ON oiv.orderItemId = oi.id
      WHERE oi.orderId = @oid
    `);

    const delReq = new sql.Request(transaction as any);
    await delReq.input('oid', sql.Int, orderId)
      .query('DELETE FROM OrderItems WHERE orderId = @oid');

    let itemsTotal = 0;
    const itemsWithPrice: ItemWithPrice[] = [];
    for (const it of data.items) {
      const item = await calcItemPrice(transaction, it);
      itemsWithPrice.push(item);
      itemsTotal += item.finalPrice * it.quantity;
    }

    const deliveryFee = data.deliveryFee || 0;
    const grandTotal = Math.round((itemsTotal + deliveryFee) * 100) / 100;

    const updReq = new sql.Request(transaction as any);
    await updReq
      .input('id', sql.Int, orderId)
      .input('businessId', sql.UniqueIdentifier, businessId)
      .input('customerId', sql.UniqueIdentifier, data.customerId)
      .input('total', sql.Decimal(12, 2), grandTotal)
      .input('paymentMethod', sql.NVarChar(50), data.paymentMethod || null)
      .input('deliveryAddress', sql.NVarChar(500), data.deliveryAddress || null)
      .input('notes', sql.NVarChar(1000), data.notes || null)
      .input('deliveryFee', sql.Decimal(10, 2), deliveryFee)
      .query(`
        UPDATE Orders SET
          customerId = @customerId, total = @total,
          paymentMethod = @paymentMethod, deliveryAddress = @deliveryAddress,
          notes = @notes, deliveryFee = @deliveryFee
        WHERE id = @id AND businessId = @businessId
      `);

    await insertItems(transaction as any, orderId, itemsWithPrice);
    await transaction.commit();

    return findOrderById(orderId);
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* ignore */ }
    throw err;
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/repositories/order.repository.ts
git commit -m "feat: order repository — businessId isolation, variations, remove pizza logic"
```

---

## Task 9: Update dashboard repository

**Files:**
- Modify: `src/repositories/dashboard.repository.ts`

- [ ] **Step 1: Add `businessId` filter to all queries in `src/repositories/dashboard.repository.ts`**

Replace the full file:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/repositories/dashboard.repository.ts
git commit -m "feat: dashboard repository — add businessId isolation to all queries"
```

---

## Task 9b: Update customer-dashboard repository

**Files:**
- Modify: `src/repositories/customer-dashboard.repository.ts`

- [ ] **Step 1: Add `businessId` filter to all queries**

Replace the full file:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/repositories/customer-dashboard.repository.ts
git commit -m "feat: customer-dashboard repository — add businessId isolation"
```

---

## Task 10: Product service + controller + routes for variations

**Files:**
- Modify: `src/services/product.service.ts`
- Modify: `src/controllers/product.controller.ts`
- Modify: `src/routes/product.routes.ts`

- [ ] **Step 1: Read `src/services/product.service.ts` and add variation methods**

Open the file and append these functions after the existing ones (keeping all existing functions intact):

```typescript
// Add these imports at the top if not present:
// import * as productRepo from '../repositories/product.repository';

export const listVariations = async (productId: string) => {
  return productRepo.getVariationsByProduct(productId);
};

export const createVariation = async (productId: string, data: import('../dtos/product.dto').CreateVariationDTO) => {
  return productRepo.createVariation(productId, data);
};

export const updateVariation = async (variationId: string, data: import('../dtos/product.dto').UpdateVariationDTO) => {
  return productRepo.updateVariation(variationId, data);
};

export const deleteVariation = async (variationId: string) => {
  return productRepo.deleteVariation(variationId);
};
```

- [ ] **Step 2: Add variation handlers to `src/controllers/product.controller.ts`**

Append to the file (after the existing handlers):

```typescript
export const listVariations = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const variations = await productService.listVariations(req.params.id);
    res.json(variations);
  } catch (err) {
    next(err);
  }
};

export const createVariation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const created = await productService.createVariation(req.params.id, req.body);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
};

export const updateVariation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await productService.updateVariation(req.params.vid, req.body);
    if (!updated) return res.status(404).json({ message: 'Variação não encontrada' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

export const deleteVariation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await productService.deleteVariation(req.params.vid);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
```

- [ ] **Step 3: Add variation routes to `src/routes/product.routes.ts`**

Replace the file with:

```typescript
import { Router } from 'express';
import * as productCtrl from '../controllers/product.controller';

const router = Router();

router.get('/', productCtrl.listProducts);
router.get('/:id', productCtrl.getProduct);
router.post('/', productCtrl.createProduct);
router.put('/:id', productCtrl.updateProduct);
router.delete('/:id', productCtrl.deleteProduct);

// Variations
router.get('/:id/variations', productCtrl.listVariations);
router.post('/:id/variations', productCtrl.createVariation);
router.put('/:id/variations/:vid', productCtrl.updateVariation);
router.delete('/:id/variations/:vid', productCtrl.deleteVariation);

export default router;
```

- [ ] **Step 4: Commit**

```bash
git add src/services/product.service.ts src/controllers/product.controller.ts src/routes/product.routes.ts
git commit -m "feat: product variations — service, controller, and routes"
```

---

## Task 11: Clean up order service (remove pizza-specific logic)

**Files:**
- Modify: `src/services/order.service.ts`

- [ ] **Step 1: Rewrite `src/services/order.service.ts`**

Remove the loyalty card, pizza emojis, and `topPizzaName` branding. Replace with generic messages:

```typescript
import * as orderRepo from '../repositories/order.repository';
import * as customerRepo from '../repositories/customer.repository';
import { sendTextMessage } from './whatsapp.service';
import { CreateOrderDTO } from '../dtos/order.dto';
import logger from '../utils/logger';
import { broadcast } from './notification.service';

export const createOrder = async (data: CreateOrderDTO) => {
  const customer = await customerRepo.findCustomerById(data.customerId);
  if (!customer) throw new Error('Cliente não encontrado');
  const order = await orderRepo.createOrder(data);

  try {
    broadcast('new-order', {
      id: order.id,
      customerName: customer.name,
      total: order.total,
      itemCount: order.items ? order.items.reduce((s: number, it: any) => s + it.quantity, 0) : 0,
    });
  } catch (err) {
    logger.warn('[Notification] failed to broadcast new-order: ' + (err as Error).message);
  }

  return order;
};

export const getAllOrders = async () => {
  return orderRepo.findAllOrders();
};

export const getOrdersForCustomer = async (customerId: string) => {
  return orderRepo.findOrdersByCustomer(customerId);
};

export const setOrderStatus = async (orderId: number, status: string) => {
  const updated = await orderRepo.updateOrderStatus(orderId, status);
  if (!updated) return updated;

  notifyCustomerStatusChange(orderId, status).catch((err) => {
    logger.warn(`[WhatsApp] Falha ao notificar pedido ${orderId}: ${err.message}`);
  });

  return updated;
};

async function notifyCustomerStatusChange(orderId: number, status: string): Promise<void> {
  const statusMessages: Record<string, string> = {
    PREPARING: '👨‍🍳 Seu pedido está sendo *preparado*! Em breve estará pronto.',
    OUT_FOR_DELIVERY: '🛵 Seu pedido *saiu para entrega*! Fique atento!',
    DELIVERED: '✅ Seu pedido foi *entregue*! Obrigado pela preferência!',
  };

  const msg = statusMessages[status];
  if (!msg) return;

  const order = await orderRepo.findOrderById(orderId);
  if (!order?.customerId) return;

  const customer = await customerRepo.findCustomerById(order.customerId);
  if (!customer?.phone) return;

  let text = `🍽️ *Pedido #${orderId}*\n\n${msg}`;

  if (status === 'DELIVERED') {
    text += '\n\n' + buildReceiptText(order, customer.name);
  }

  await sendTextMessage(customer.phone, text);
}

function formatBrl(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function buildReceiptText(order: any, customerName: string): string {
  const lines: string[] = [];
  lines.push('─────────────────');
  lines.push('📋 *NOTA DO PEDIDO*');
  lines.push('─────────────────');
  lines.push('');

  const date = order.createdAt ? new Date(order.createdAt).toLocaleString('pt-BR') : '';
  if (date) lines.push(`📅 ${date}`);
  lines.push(`👤 ${customerName}`);
  if (order.deliveryAddress) lines.push(`📍 ${order.deliveryAddress}`);
  if (order.paymentMethod) {
    const paymentLabels: Record<string, string> = {
      CASH: 'Dinheiro', CREDIT: 'Crédito', DEBIT: 'Débito', PIX: 'PIX'
    };
    lines.push(`💳 ${paymentLabels[order.paymentMethod] || order.paymentMethod}`);
  }
  if (order.notes) lines.push(`📝 ${order.notes}`);

  lines.push('');
  lines.push('─────────────────');

  if (order.items?.length) {
    for (const item of order.items) {
      const name = item.productName || 'Produto';
      const qty = item.quantity;
      const price = parseFloat(item.finalPrice) || 0;
      lines.push(`${qty}x ${name}  ${formatBrl(qty * price)}`);
      if (item.variations?.length) {
        for (const v of item.variations) {
          lines.push(`   + ${v.variationName}`);
        }
      }
    }
  }

  if (order.deliveryFee && parseFloat(order.deliveryFee) > 0) {
    lines.push(`🚚 Taxa de entrega  ${formatBrl(parseFloat(order.deliveryFee))}`);
  }

  lines.push('─────────────────');
  lines.push(`*TOTAL: ${formatBrl(parseFloat(order.total))}*`);
  lines.push('─────────────────');
  lines.push('');
  lines.push('Obrigado pela preferência! ❤️');

  return lines.join('\n');
}

export const getOrderById = async (orderId: number) => {
  return orderRepo.findOrderById(orderId);
};

export const deleteOrder = async (orderId: number) => {
  return orderRepo.deleteOrder(orderId);
};

export const updateOrder = async (orderId: number, data: CreateOrderDTO) => {
  return orderRepo.updateOrder(orderId, data);
};
```

- [ ] **Step 2: Commit**

```bash
git add src/services/order.service.ts
git commit -m "feat: order service — remove pizza-specific loyalty/branding, generic receipt"
```

---

## Task 12: Update WhatsApp service + final cleanup

**Files:**
- Modify: `src/services/whatsapp.service.ts`
- Modify: `package.json`
- Modify: `src/scripts/seed-master.ts`
- Delete: `src/scripts/migrate-azure.ts`

- [ ] **Step 1: Update `src/services/whatsapp.service.ts`**

Replace the hardcoded tenant context block (lines 55-59) with businessStorage:

```typescript
// Change this import at the top:
// FROM: import { tenantStorage } from '../database/tenantContext';
// TO:
import { businessStorage } from '../database/businessContext';

// Replace the whatsappTenantContext block and the tenantStorage.run() call:
const whatsappBusinessContext = {
  businessId: process.env.WHATSAPP_BUSINESS_ID || '',
  userId: 'whatsapp-bot',
  role: 'bot',
};

// In the client.on('message') handler, replace:
// tenantStorage.run(whatsappTenantContext, () => handleMessage(...))
// with:
// businessStorage.run(whatsappBusinessContext, () => handleMessage(...))
```

The full updated `client.on('message')` block should be:

```typescript
client.on('message', async (message: Message) => {
  try {
    if (message.fromMe || message.from.endsWith('@g.us') || message.from === 'status@broadcast') return;
    if (!message.body) return;

    const reply = await businessStorage.run(whatsappBusinessContext, () =>
      handleMessage(message.from, message.body)
    );
    if (reply) await client.sendMessage(message.from, reply);
  } catch (err: any) {
    logger.error(`[WhatsApp Bot] Erro ao processar mensagem de ${message.from}: ${err.message}`);
  }
});
```

- [ ] **Step 2: Update `.env.example`**

Replace `DB_NAME=Pizzaria` with `DB_NAME=RestaurantHub` and add `WHATSAPP_BUSINESS_ID=`:

```
DB_HOST=localhost
DB_PORT=1433
DB_USER=sa
DB_PASSWORD=your_db_password
DB_NAME=RestaurantHub
PORT=3000

JWT_SECRET=replace_with_a_secure_random_value
WHATSAPP_BUSINESS_ID=
```

- [ ] **Step 3: Rename project in `package.json`**

Change `"name": "pizzaria-api"` to `"name": "restaurant-api"`.

- [ ] **Step 4: Update `src/scripts/seed-master.ts`**

Replace all references to `Tenants` with `Businesses`, remove `dbName` column, and update field names from `tenantName`/`tenantSlug` to `businessName`/`businessSlug`. The updated insert should be:

```typescript
// Replace the Tenants table creation and insert with:
await pool.request().query(`
  IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Businesses')
  CREATE TABLE Businesses (
    id        UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    name      NVARCHAR(200) NOT NULL,
    slug      NVARCHAR(100) NOT NULL,
    active    BIT NOT NULL DEFAULT 1,
    createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Businesses_slug UNIQUE (slug)
  )
`);

// Replace the seed insert with:
await pool.request().query(`
  IF NOT EXISTS (SELECT * FROM Businesses WHERE slug = 'demo')
  INSERT INTO Businesses (name, slug) VALUES ('Demo Restaurant', 'demo')
`);
```

- [ ] **Step 5: Delete `src/scripts/migrate-azure.ts`**

```bash
rm src/scripts/migrate-azure.ts
```

- [ ] **Step 6: Run TypeScript compilation to verify no errors**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/services/whatsapp.service.ts .env.example package.json src/scripts/seed-master.ts
git rm src/scripts/migrate-azure.ts
git commit -m "feat: final cleanup — whatsapp businessStorage, rename project, update seed"
```

---

## Task 13: Smoke test

- [ ] **Step 1: Update `.env` with new database name**

Set `DB_NAME=RestaurantHub` (or whatever name you created in Azure Portal).

- [ ] **Step 2: Run the init script against the new Azure SQL database**

Connect to the new database via Azure Data Studio or SQL Server Management Studio and run `database/init.sql`.

- [ ] **Step 3: Start the server**

```bash
npm run dev
```

Expected: Server starts without TypeScript or connection errors.

- [ ] **Step 4: Register a new business**

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","email":"admin@test.com","password":"123456","businessName":"Burger Test","businessSlug":"burger-test"}'
```

Expected: 200 with `token` and `user.businessName = "Burger Test"`.

- [ ] **Step 5: Create a product with a variation**

```bash
# Use the token from the register response
curl -X POST http://localhost:3000/api/products \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"X-Burguer","price":25.00,"category":"lanche"}'

# Then add a variation
curl -X POST http://localhost:3000/api/products/<productId>/variations \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Extra Bacon","type":"addon","priceModifier":5.00}'
```

Expected: Product created, variation returned with `priceModifier: 5`.

- [ ] **Step 6: Create an order with the variation**

```bash
# First create a customer
curl -X POST http://localhost:3000/api/customers \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"João","phone":"11999990000"}'

# Then create an order
curl -X POST http://localhost:3000/api/orders \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "<customerId>",
    "items": [{"productId":"<productId>","quantity":1,"variations":[{"variationId":"<variationId>"}]}],
    "paymentMethod": "PIX",
    "deliveryFee": 5.00
  }'
```

Expected: Order returned with `total = 35.00` (25 + 5 variation + 5 delivery), item has `finalPrice = 30.00`.

- [ ] **Step 7: Final commit if any adjustments were needed**

```bash
git add -A
git commit -m "fix: smoke test adjustments"
```
