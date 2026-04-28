import { getPool, sql } from '../database/mssqlClient';
import { getBusinessContext } from '../database/businessContext';
import { CreateCustomerDTO, UpdateCustomerDTO } from '../dtos/customer.dto';

function bindAddressInputs(request: any, data: Partial<CreateCustomerDTO>): void {
  request.input('cep',          sql.NVarChar(9),   data.cep ?? null);
  request.input('street',       sql.NVarChar(200), data.street ?? null);
  request.input('number',       sql.NVarChar(20),  data.number ?? null);
  request.input('complement',   sql.NVarChar(200), data.complement ?? null);
  request.input('neighborhood', sql.NVarChar(200), data.neighborhood ?? null);
  request.input('city',         sql.NVarChar(100), data.city ?? null);
  request.input('uf',           sql.NVarChar(2),   data.uf ?? null);
  request.input('latitude',     sql.Decimal(9, 6), data.latitude ?? null);
  request.input('longitude',    sql.Decimal(9, 6), data.longitude ?? null);
}

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
  request.input('name',       sql.NVarChar(200), data.name);
  request.input('phone',      sql.NVarChar(50),  data.phone);
  request.input('address',    sql.NVarChar(500), data.address || null);
  bindAddressInputs(request, data);
  const result = await request.query(
    `INSERT INTO Customers (businessId, name, phone, address, cep, street, [number], complement, neighborhood, city, uf, latitude, longitude)
     OUTPUT inserted.*
     VALUES (@businessId, @name, @phone, @address, @cep, @street, @number, @complement, @neighborhood, @city, @uf, @latitude, @longitude)`
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

export const findCustomerByPhone = async (phone: string) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const request = conn.request();
  request.input('phone', sql.NVarChar(50), phone);
  request.input('businessId', sql.UniqueIdentifier, businessId);
  const result = await request.query(
    `SELECT TOP 1 * FROM Customers WHERE businessId = @businessId AND phone = @phone`
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
  request.input('id',         sql.UniqueIdentifier, id);
  request.input('businessId', sql.UniqueIdentifier, businessId);
  request.input('name',       sql.NVarChar(200), data.name ?? null);
  request.input('phone',      sql.NVarChar(50),  data.phone ?? null);
  request.input('address',    sql.NVarChar(500), data.address ?? null);
  bindAddressInputs(request, data);
  const result = await request.query(
    `UPDATE Customers SET
       name         = COALESCE(@name, name),
       phone        = COALESCE(@phone, phone),
       address      = COALESCE(@address, address),
       cep          = COALESCE(@cep, cep),
       street       = COALESCE(@street, street),
       [number]     = COALESCE(@number, [number]),
       complement   = COALESCE(@complement, complement),
       neighborhood = COALESCE(@neighborhood, neighborhood),
       city         = COALESCE(@city, city),
       uf           = COALESCE(@uf, uf),
       latitude     = COALESCE(@latitude, latitude),
       longitude    = COALESCE(@longitude, longitude)
     OUTPUT inserted.*
     WHERE id = @id AND businessId = @businessId`
  );
  return result.recordset[0];
};

export const upsertCustomerByPhone = async (data: CreateCustomerDTO) => {
  const existing = await findCustomerByPhone(data.phone);
  if (existing) {
    return await updateCustomer(existing.id, data);
  }
  return await createCustomer(data);
};

export const deleteCustomer = async (id: string) => {
  const { businessId } = getBusinessContext()!;
  const conn = await getPool();
  const request = conn.request();
  request.input('id', sql.UniqueIdentifier, id);
  request.input('businessId', sql.UniqueIdentifier, businessId);
  // Desvincula pedidos existentes antes de deletar (preserva histórico)
  await request.query('UPDATE Orders SET customerId = NULL WHERE customerId = @id AND businessId = @businessId');
  await conn.request()
    .input('id', sql.UniqueIdentifier, id)
    .input('businessId', sql.UniqueIdentifier, businessId)
    .query('DELETE FROM Customers WHERE id = @id AND businessId = @businessId');
};
