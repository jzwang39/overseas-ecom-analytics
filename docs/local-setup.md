# 本地初始化指南（macOS）

## 0. 前置要求

- Node.js 20+
- MySQL 8.x（或 5.7+，需要支持 JSON 类型）

## 1. 安装依赖

在项目根目录执行：

```bash
npm install
```

## 2. 准备数据库

### 方案 A：本机 MySQL

确保能连接到 MySQL 后，创建数据库（示例）：

```sql
CREATE DATABASE overseas_ecom_analytics CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

### 方案 B：Docker MySQL（可选）

如果你用 Docker 跑 MySQL，请确保端口映射到 3306，并创建同名数据库。

## 3. 配置环境变量

复制模板：

```bash
cp .env.local.example .env.local
```

然后编辑 `.env.local`：

- `DB_*`：指向你的 MySQL
- `NEXTAUTH_SECRET`：建议用下面命令生成
- `INITIAL_SUPER_ADMIN_*`：用于首次创建超级管理员账号

生成 secret（推荐）：

```bash
openssl rand -base64 32
```

## 4. 初始化表结构与超级管理员

```bash
npm run db:migrate
npm run db:seed
```

说明：

- `db:migrate` 会执行 `db/migrations/*.sql`
- `db:seed` 会创建默认角色与一个超级管理员（如果数据库中还没有 super_admin）
- 这两个脚本会自动读取 `.env.local`（也支持 `.env`）

## 5. 启动项目

```bash
npm run dev
```

打开：

- http://localhost:3000
- 登录页：http://localhost:3000/auth/login

登录成功后：

- 工作台：`/work`
- 配置管理（管理员以上）：`/settings/users`

## 6. 常见问题排查

### 6.1 缺少 DB_DATABASE

报错：`缺少环境变量 DB_DATABASE`

- 检查 `.env.local` 是否存在并且填写了 `DB_DATABASE`

### 6.2 无法登录 / middleware 一直跳转

确保设置了：

- `NEXTAUTH_URL=http://localhost:3000`
- `NEXTAUTH_SECRET=...`

### 6.3 迁移报权限不足

给 MySQL 用户足够权限（示例）：

```sql
GRANT ALL PRIVILEGES ON overseas_ecom_analytics.* TO 'root'@'%';
FLUSH PRIVILEGES;
```

