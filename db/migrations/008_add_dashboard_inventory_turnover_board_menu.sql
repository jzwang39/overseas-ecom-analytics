UPDATE roles
SET menu_keys = JSON_ARRAY_APPEND(menu_keys, '$', 'dashboard.inventory_turnover_board')
WHERE deleted_at IS NULL
  AND menu_keys IS NOT NULL
  AND JSON_CONTAINS(menu_keys, CAST('\"dashboard.inventory_turnover_board\"' AS JSON)) = 0;
