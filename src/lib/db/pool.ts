import "server-only";

import mysql from "mysql2/promise";
import { getDbConfig } from "./config";

const globalForMySql = globalThis as typeof globalThis & {
  __mysqlPool?: mysql.Pool;
};

export function getPool() {
  if (globalForMySql.__mysqlPool) return globalForMySql.__mysqlPool;
  const config = getDbConfig();
  globalForMySql.__mysqlPool = mysql.createPool({
    ...config,
    connectionLimit: 10,
    multipleStatements: true,
  });
  return globalForMySql.__mysqlPool;
}
