export function getDbConfig() {
  const host = process.env.DB_HOST ?? "127.0.0.1";
  const port = Number(process.env.DB_PORT ?? "3306");
  const user = process.env.DB_USER ?? "root";
  const password = process.env.DB_PASSWORD ?? "";
  const database = process.env.DB_DATABASE ?? "";

  if (!database) {
    throw new Error("缺少环境变量 DB_DATABASE");
  }

  return { host, port, user, password, database };
}

