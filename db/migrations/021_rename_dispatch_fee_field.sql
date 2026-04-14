-- Rename 派送费（需要测试？）to 派送费 in workspace_records.data JSON

UPDATE workspace_records
SET data = JSON_SET(
  JSON_REMOVE(data, '$."派送费（需要测试？）"'),
  '$."派送费"',
  JSON_EXTRACT(data, '$."派送费（需要测试？）"')
)
WHERE JSON_EXTRACT(data, '$."派送费（需要测试？）"') IS NOT NULL
  AND deleted_at IS NULL;
