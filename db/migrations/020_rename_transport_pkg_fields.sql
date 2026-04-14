-- Rename 运输包装-* fields to 外箱-* in workspace_records.data JSON

UPDATE workspace_records
SET data = JSON_SET(JSON_REMOVE(data, '$."运输包装尺寸-长（厘米）"'), '$."外箱尺寸-长（厘米）"', JSON_EXTRACT(data, '$."运输包装尺寸-长（厘米）"'))
WHERE JSON_EXTRACT(data, '$."运输包装尺寸-长（厘米）"') IS NOT NULL AND deleted_at IS NULL;

UPDATE workspace_records
SET data = JSON_SET(JSON_REMOVE(data, '$."运输包装尺寸-宽（厘米）"'), '$."外箱尺寸-宽（厘米）"', JSON_EXTRACT(data, '$."运输包装尺寸-宽（厘米）"'))
WHERE JSON_EXTRACT(data, '$."运输包装尺寸-宽（厘米）"') IS NOT NULL AND deleted_at IS NULL;

UPDATE workspace_records
SET data = JSON_SET(JSON_REMOVE(data, '$."运输包装尺寸-高（厘米）"'), '$."外箱尺寸-高（厘米）"', JSON_EXTRACT(data, '$."运输包装尺寸-高（厘米）"'))
WHERE JSON_EXTRACT(data, '$."运输包装尺寸-高（厘米）"') IS NOT NULL AND deleted_at IS NULL;

UPDATE workspace_records
SET data = JSON_SET(JSON_REMOVE(data, '$."运输包装体积"'), '$."外箱体积"', JSON_EXTRACT(data, '$."运输包装体积"'))
WHERE JSON_EXTRACT(data, '$."运输包装体积"') IS NOT NULL AND deleted_at IS NULL;

UPDATE workspace_records
SET data = JSON_SET(JSON_REMOVE(data, '$."运输包装实重"'), '$."外箱实重"', JSON_EXTRACT(data, '$."运输包装实重"'))
WHERE JSON_EXTRACT(data, '$."运输包装实重"') IS NOT NULL AND deleted_at IS NULL;

UPDATE workspace_records
SET data = JSON_SET(JSON_REMOVE(data, '$."运输包装体积重"'), '$."外箱体积重"', JSON_EXTRACT(data, '$."运输包装体积重"'))
WHERE JSON_EXTRACT(data, '$."运输包装体积重"') IS NOT NULL AND deleted_at IS NULL;

UPDATE workspace_records
SET data = JSON_SET(JSON_REMOVE(data, '$."运输包装计费重"'), '$."外箱计费重"', JSON_EXTRACT(data, '$."运输包装计费重"'))
WHERE JSON_EXTRACT(data, '$."运输包装计费重"') IS NOT NULL AND deleted_at IS NULL;

UPDATE workspace_records
SET data = JSON_SET(JSON_REMOVE(data, '$."运输包装体积系数"'), '$."外箱体积系数"', JSON_EXTRACT(data, '$."运输包装体积系数"'))
WHERE JSON_EXTRACT(data, '$."运输包装体积系数"') IS NOT NULL AND deleted_at IS NULL;
