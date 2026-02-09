CREATE TABLE IF NOT EXISTS record_field_defs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  record_type VARCHAR(64) NOT NULL,
  field_key VARCHAR(255) NOT NULL,
  sort_order INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_record_type_field_key (record_type, field_key),
  KEY idx_record_type (record_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_ops_record_fields (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sales_ops_record_id BIGINT UNSIGNED NOT NULL,
  field_key VARCHAR(255) NOT NULL,
  field_value TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_sales_ops_record_id_field_key (sales_ops_record_id, field_key),
  KEY idx_sales_ops_record_id (sales_ops_record_id),
  KEY idx_field_key (field_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_record_fields (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  inventory_record_id BIGINT UNSIGNED NOT NULL,
  field_key VARCHAR(255) NOT NULL,
  field_value TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_inventory_record_id_field_key (inventory_record_id, field_key),
  KEY idx_inventory_record_id (inventory_record_id),
  KEY idx_field_key (field_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_data_record_fields (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sales_data_record_id BIGINT UNSIGNED NOT NULL,
  field_key VARCHAR(255) NOT NULL,
  field_value TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_sales_data_record_id_field_key (sales_data_record_id, field_key),
  KEY idx_sales_data_record_id (sales_data_record_id),
  KEY idx_field_key (field_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS penalty_amount_record_fields (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  penalty_amount_record_id BIGINT UNSIGNED NOT NULL,
  field_key VARCHAR(255) NOT NULL,
  field_value TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_penalty_amount_record_id_field_key (penalty_amount_record_id, field_key),
  KEY idx_penalty_amount_record_id (penalty_amount_record_id),
  KEY idx_field_key (field_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS warehouse_cost_record_fields (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  warehouse_cost_record_id BIGINT UNSIGNED NOT NULL,
  field_key VARCHAR(255) NOT NULL,
  field_value TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_warehouse_cost_record_id_field_key (warehouse_cost_record_id, field_key),
  KEY idx_warehouse_cost_record_id (warehouse_cost_record_id),
  KEY idx_field_key (field_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO sales_ops_record_fields(sales_ops_record_id, field_key, field_value)
SELECT t.record_id, t.field_key, t.field_value
FROM (
  SELECT
    r.id AS record_id,
    jt.k AS field_key,
    NULLIF(
      JSON_UNQUOTE(JSON_EXTRACT(r.data, CONCAT('$."', REPLACE(jt.k, '"', '\\\\"'), '"'))),
      ''
    ) AS field_value
  FROM sales_ops_records r
  JOIN JSON_TABLE(JSON_KEYS(r.data), '$[*]' COLUMNS(k VARCHAR(255) PATH '$')) jt
  WHERE JSON_TYPE(r.data) = 'OBJECT'
) t
WHERE t.field_value IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO inventory_record_fields(inventory_record_id, field_key, field_value)
SELECT t.record_id, t.field_key, t.field_value
FROM (
  SELECT
    r.id AS record_id,
    jt.k AS field_key,
    NULLIF(
      JSON_UNQUOTE(JSON_EXTRACT(r.data, CONCAT('$."', REPLACE(jt.k, '"', '\\\\"'), '"'))),
      ''
    ) AS field_value
  FROM inventory_records r
  JOIN JSON_TABLE(JSON_KEYS(r.data), '$[*]' COLUMNS(k VARCHAR(255) PATH '$')) jt
  WHERE JSON_TYPE(r.data) = 'OBJECT'
) t
WHERE t.field_value IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO sales_data_record_fields(sales_data_record_id, field_key, field_value)
SELECT t.record_id, t.field_key, t.field_value
FROM (
  SELECT
    r.id AS record_id,
    jt.k AS field_key,
    NULLIF(
      JSON_UNQUOTE(JSON_EXTRACT(r.data, CONCAT('$."', REPLACE(jt.k, '"', '\\\\"'), '"'))),
      ''
    ) AS field_value
  FROM sales_data_records r
  JOIN JSON_TABLE(JSON_KEYS(r.data), '$[*]' COLUMNS(k VARCHAR(255) PATH '$')) jt
  WHERE JSON_TYPE(r.data) = 'OBJECT'
) t
WHERE t.field_value IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO penalty_amount_record_fields(penalty_amount_record_id, field_key, field_value)
SELECT t.record_id, t.field_key, t.field_value
FROM (
  SELECT
    r.id AS record_id,
    jt.k AS field_key,
    NULLIF(
      JSON_UNQUOTE(JSON_EXTRACT(r.data, CONCAT('$."', REPLACE(jt.k, '"', '\\\\"'), '"'))),
      ''
    ) AS field_value
  FROM penalty_amount_records r
  JOIN JSON_TABLE(JSON_KEYS(r.data), '$[*]' COLUMNS(k VARCHAR(255) PATH '$')) jt
  WHERE JSON_TYPE(r.data) = 'OBJECT'
) t
WHERE t.field_value IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO warehouse_cost_record_fields(warehouse_cost_record_id, field_key, field_value)
SELECT t.record_id, t.field_key, t.field_value
FROM (
  SELECT
    r.id AS record_id,
    jt.k AS field_key,
    NULLIF(
      JSON_UNQUOTE(JSON_EXTRACT(r.data, CONCAT('$."', REPLACE(jt.k, '"', '\\\\"'), '"'))),
      ''
    ) AS field_value
  FROM warehouse_cost_records r
  JOIN JSON_TABLE(JSON_KEYS(r.data), '$[*]' COLUMNS(k VARCHAR(255) PATH '$')) jt
  WHERE JSON_TYPE(r.data) = 'OBJECT'
) t
WHERE t.field_value IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT IGNORE INTO record_field_defs(record_type, field_key)
SELECT 'sales_ops', field_key
FROM sales_ops_record_fields
GROUP BY field_key;

INSERT IGNORE INTO record_field_defs(record_type, field_key)
SELECT 'inventory_turnover', field_key
FROM inventory_record_fields
GROUP BY field_key;

INSERT IGNORE INTO record_field_defs(record_type, field_key)
SELECT 'sales_data', field_key
FROM sales_data_record_fields
GROUP BY field_key;

INSERT IGNORE INTO record_field_defs(record_type, field_key)
SELECT 'penalty_amount', field_key
FROM penalty_amount_record_fields
GROUP BY field_key;

INSERT IGNORE INTO record_field_defs(record_type, field_key)
SELECT 'warehouse_cost', field_key
FROM warehouse_cost_record_fields
GROUP BY field_key;

ALTER TABLE sales_ops_records DROP COLUMN data;
ALTER TABLE inventory_records DROP COLUMN data;
ALTER TABLE sales_data_records DROP COLUMN data;
ALTER TABLE penalty_amount_records DROP COLUMN data;
ALTER TABLE warehouse_cost_records DROP COLUMN data;
