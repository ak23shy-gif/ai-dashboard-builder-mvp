import mysql from 'mysql2/promise';
import { Client as PgClient } from 'pg';
import sql from 'mssql';
import { normaliseRawRows, type ImportedDataset } from '@/lib/data/importData';

export type DatabaseProvider = 'postgres' | 'mysql' | 'sqlserver';

export type DatabaseConnectionInput = {
  provider: DatabaseProvider;
  host: string;
  port?: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
};

export type DatabaseTable = {
  schema: string;
  name: string;
};

type RawRow = Record<string, unknown>;

const previewLimit = 1000;

function assertConnectionInput(connection: DatabaseConnectionInput) {
  if (!['postgres', 'mysql', 'sqlserver'].includes(connection.provider)) {
    throw new Error('Unsupported database provider.');
  }

  if (!connection.host || !connection.database || !connection.username) {
    throw new Error('Host, database and username are required.');
  }
}

function safeIdentifier(value: string) {
  if (!/^[\w .-]+$/.test(value)) {
    throw new Error('Invalid table or schema name.');
  }

  return value;
}

function quotePostgresIdentifier(value: string) {
  return `"${safeIdentifier(value).replace(/"/g, '""')}"`;
}

function quoteMysqlIdentifier(value: string) {
  return `\`${safeIdentifier(value).replace(/`/g, '``')}\``;
}

function quoteSqlServerIdentifier(value: string) {
  return `[${safeIdentifier(value).replace(/]/g, ']]')}]`;
}

async function withPostgres<T>(connection: DatabaseConnectionInput, callback: (client: PgClient) => Promise<T>) {
  const client = new PgClient({
    host: connection.host,
    port: connection.port || 5432,
    database: connection.database,
    user: connection.username,
    password: connection.password,
    ssl: connection.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 8000,
  });

  await client.connect();

  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function withMysql<T>(connection: DatabaseConnectionInput, callback: (client: mysql.Connection) => Promise<T>) {
  const client = await mysql.createConnection({
    host: connection.host,
    port: connection.port || 3306,
    database: connection.database,
    user: connection.username,
    password: connection.password,
    ssl: connection.ssl ? {} : undefined,
    connectTimeout: 8000,
  });

  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function withSqlServer<T>(connection: DatabaseConnectionInput, callback: (pool: sql.ConnectionPool) => Promise<T>) {
  const pool = await sql.connect({
    server: connection.host,
    port: connection.port || 1433,
    database: connection.database,
    user: connection.username,
    password: connection.password,
    connectionTimeout: 8000,
    requestTimeout: 12000,
    options: {
      encrypt: Boolean(connection.ssl),
      trustServerCertificate: true,
    },
  });

  try {
    return await callback(pool);
  } finally {
    await pool.close();
  }
}

export async function testDatabaseConnection(connection: DatabaseConnectionInput) {
  assertConnectionInput(connection);

  if (connection.provider === 'postgres') {
    await withPostgres(connection, async (client) => {
      await client.query('select 1 as ok');
    });
  }

  if (connection.provider === 'mysql') {
    await withMysql(connection, async (client) => {
      await client.query('select 1 as ok');
    });
  }

  if (connection.provider === 'sqlserver') {
    await withSqlServer(connection, async (pool) => {
      await pool.request().query('select 1 as ok');
    });
  }

  return { ok: true };
}

export async function listDatabaseTables(connection: DatabaseConnectionInput): Promise<DatabaseTable[]> {
  assertConnectionInput(connection);

  if (connection.provider === 'postgres') {
    return withPostgres(connection, async (client) => {
      const result = await client.query<DatabaseTable>(`
        select table_schema as schema, table_name as name
        from information_schema.tables
        where table_type = 'BASE TABLE'
          and table_schema not in ('pg_catalog', 'information_schema')
        order by table_schema, table_name
        limit 200
      `);

      return result.rows;
    });
  }

  if (connection.provider === 'mysql') {
    return withMysql(connection, async (client) => {
      const [rows] = await client.query<mysql.RowDataPacket[]>(`
        select table_schema as \`schema\`, table_name as name
        from information_schema.tables
        where table_type = 'BASE TABLE'
          and table_schema = database()
        order by table_name
        limit 200
      `);

      return rows.map((row) => ({ schema: String(row.schema), name: String(row.name) }));
    });
  }

  return withSqlServer(connection, async (pool) => {
    const result = await pool.request().query(`
      select top 200 table_schema as [schema], table_name as [name]
      from information_schema.tables
      where table_type = 'BASE TABLE'
      order by table_schema, table_name
    `);

    return result.recordset.map((row) => ({ schema: String(row.schema), name: String(row.name) }));
  });
}

export async function previewDatabaseTable(
  connection: DatabaseConnectionInput,
  table: DatabaseTable,
): Promise<ImportedDataset> {
  assertConnectionInput(connection);

  const schema = safeIdentifier(table.schema);
  const tableName = safeIdentifier(table.name);
  let rawRows: RawRow[] = [];

  if (connection.provider === 'postgres') {
    rawRows = await withPostgres(connection, async (client) => {
      const result = await client.query<RawRow>(
        `select * from ${quotePostgresIdentifier(schema)}.${quotePostgresIdentifier(tableName)} limit ${previewLimit}`,
      );
      return result.rows;
    });
  }

  if (connection.provider === 'mysql') {
    rawRows = await withMysql(connection, async (client) => {
      const [rows] = await client.query<mysql.RowDataPacket[]>(
        `select * from ${quoteMysqlIdentifier(tableName)} limit ${previewLimit}`,
      );
      return rows as RawRow[];
    });
  }

  if (connection.provider === 'sqlserver') {
    rawRows = await withSqlServer(connection, async (pool) => {
      const result = await pool.request().query(
        `select top (${previewLimit}) * from ${quoteSqlServerIdentifier(schema)}.${quoteSqlServerIdentifier(tableName)}`,
      );
      return result.recordset as RawRow[];
    });
  }

  const { columns, mappedColumns, rows } = normaliseRawRows(rawRows);

  if (!rows.length) {
    throw new Error(`Connected to ${schema}.${tableName}, but no usable numeric preview rows were found.`);
  }

  return {
    fileName: `${connection.database}.${schema}.${tableName}`,
    rows,
    columns: [
      ...columns,
      `Mapped date: ${mappedColumns.date || mappedColumns.month || 'not found, defaulted to Jan'}`,
      `Mapped leads: ${mappedColumns.leads || 'not found'}`,
      `Mapped valuations: ${mappedColumns.valuations || 'calculated'}`,
      `Mapped sessions: ${mappedColumns.sessions || 'calculated'}`,
      `Mapped bookings: ${mappedColumns.bookings || 'calculated'}`,
    ],
    mappedColumns,
    rawRowCount: rawRows.length,
    processedRowCount: rows.length,
    isLimited: rawRows.length >= previewLimit,
    sourceType: 'database',
  };
}
