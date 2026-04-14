-- Rename 包裹尺寸-* fields to 单套尺寸-* in workspace_records.data JSON
-- Affects: 单套尺寸-长（厘米）, 宽, 高 and 单套尺寸-长（英寸）, 宽, 高

UPDATE workspace_records
SET data = JSON_SET(
  JSON_REMOVE(data, '$."包裹尺寸-长（厘米）"'),
  '$."单套尺寸-长（厘米）"',
  JSON_EXTRACT(data, '$."包裹尺寸-长（厘米）"')
)
WHERE JSON_EXTRACT(data, '$."包裹尺寸-长（厘米）"') IS NOT NULL
  AND deleted_at IS NULL;

UPDATE workspace_records
SET data = JSON_SET(
  JSON_REMOVE(data, '$."包裹尺寸-宽（厘米）"'),
  '$."单套尺寸-宽（厘米）"',
  JSON_EXTRACT(data, '$."包裹尺寸-宽（厘米）"')
)
WHERE JSON_EXTRACT(data, '$."包裹尺寸-宽（厘米）"') IS NOT NULL
  AND deleted_at IS NULL;

UPDATE workspace_records
SET data = JSON_SET(
  JSON_REMOVE(data, '$."包裹尺寸-高（厘米）"'),
  '$."单套尺寸-高（厘米）"',
  JSON_EXTRACT(data, '$."包裹尺寸-高（厘米）"')
)
WHERE JSON_EXTRACT(data, '$."包裹尺寸-高（厘米）"') IS NOT NULL
  AND deleted_at IS NULL;

UPDATE workspace_records
SET data = JSON_SET(
  JSON_REMOVE(data, '$."包裹尺寸-长（英寸）"'),
  '$."单套尺寸-长（英寸）"',
  JSON_EXTRACT(data, '$."包裹尺寸-长（英寸）"')
)
WHERE JSON_EXTRACT(data, '$."包裹尺寸-长（英寸）"') IS NOT NULL
  AND deleted_at IS NULL;

UPDATE workspace_records
SET data = JSON_SET(
  JSON_REMOVE(data, '$."包裹尺寸-宽（英寸）"'),
  '$."单套尺寸-宽（英寸）"',
  JSON_EXTRACT(data, '$."包裹尺寸-宽（英寸）"')
)
WHERE JSON_EXTRACT(data, '$."包裹尺寸-宽（英寸）"') IS NOT NULL
  AND deleted_at IS NULL;

UPDATE workspace_records
SET data = JSON_SET(
  JSON_REMOVE(data, '$."包裹尺寸-高（英寸）"'),
  '$."单套尺寸-高（英寸）"',
  JSON_EXTRACT(data, '$."包裹尺寸-高（英寸）"')
)
WHERE JSON_EXTRACT(data, '$."包裹尺寸-高（英寸）"') IS NOT NULL
  AND deleted_at IS NULL;
