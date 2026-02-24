ALTER TABLE workspace_records
  ADD COLUMN product_rule VARCHAR(255)
    GENERATED ALWAYS AS (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品规则"')), '')) STORED,
  ADD UNIQUE KEY uniq_workspace_records_workspace_key_product_rule_deleted_at (workspace_key, product_rule, deleted_at),
  ADD KEY idx_workspace_records_product_rule (product_rule);

