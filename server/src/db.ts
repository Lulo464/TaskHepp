import pg from 'pg';

// Return DATE columns as 'YYYY-MM-DD' strings instead of local-midnight Date objects.
pg.types.setTypeParser(pg.types.builtins.DATE, v => v);
// bigint ids (event_log) fit comfortably in a JS number.
pg.types.setTypeParser(pg.types.builtins.INT8, v => Number(v));

export type Db = pg.Pool;
export type Queryable = pg.Pool | pg.PoolClient;

/** `timeZone` makes current_date, date_trunc('day', …) etc. follow the household's local day. */
export function createPool(connectionString: string, timeZone: string): Db {
  if (!/^[A-Za-z0-9_/+-]+$/.test(timeZone)) throw new Error(`invalid time zone: ${timeZone}`);
  return new pg.Pool({ connectionString, max: 10, options: `-c TimeZone=${timeZone}` });
}

export async function withTransaction<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
