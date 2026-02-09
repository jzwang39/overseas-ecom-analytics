CREATE TABLE IF NOT EXISTS purchase_record_fields (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  purchase_record_id BIGINT UNSIGNED NOT NULL,
  field_key VARCHAR(255) NOT NULL,
  field_value TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_purchase_record_field (purchase_record_id, field_key),
  KEY idx_purchase_record_id (purchase_record_id),
  KEY idx_field_key (field_key),
  KEY idx_field_key_value (field_key, field_value(64))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '名称', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."名称"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."名称"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."名称"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '产品图片', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品图片"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."产品图片"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品图片"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '参考链接', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."参考链接"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."参考链接"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."参考链接"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '平台在售价格（Min）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."平台在售价格（Min）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."平台在售价格（Min）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."平台在售价格（Min）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '平台在售价格（Max）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."平台在售价格（Max）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."平台在售价格（Max）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."平台在售价格（Max）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '所属类目', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."所属类目"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."所属类目"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."所属类目"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '产品规格', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品规格"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."产品规格"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品规格"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '产品链接×', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品链接×"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."产品链接×"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品链接×"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '预计周平均日销量', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."预计周平均日销量"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."预计周平均日销量"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."预计周平均日销量"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '资质要求', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."资质要求"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."资质要求"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."资质要求"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '是否有专利风险', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."是否有专利风险"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."是否有专利风险"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."是否有专利风险"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '选品逻辑', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."选品逻辑"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."选品逻辑"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."选品逻辑"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '选品人', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."选品人"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."选品人"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."选品人"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '询价分配人｜选品', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."询价分配人｜选品"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."询价分配人｜选品"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."询价分配人｜选品"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '询价人', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."询价人"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."询价人"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."询价人"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '产品尺寸-长（厘米）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品尺寸-长（厘米）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."产品尺寸-长（厘米）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品尺寸-长（厘米）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '产品尺寸-宽（厘米）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品尺寸-宽（厘米）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."产品尺寸-宽（厘米）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品尺寸-宽（厘米）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '产品尺寸-高（厘米）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品尺寸-高（厘米）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."产品尺寸-高（厘米）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品尺寸-高（厘米）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '包装尺寸-长（英寸）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包装尺寸-长（英寸）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."包装尺寸-长（英寸）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包装尺寸-长（英寸）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '包装尺寸-宽（英寸）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包装尺寸-宽（英寸）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."包装尺寸-宽（英寸）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包装尺寸-宽（英寸）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '包装尺寸-高（英寸）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包装尺寸-高（英寸）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."包装尺寸-高（英寸）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包装尺寸-高（英寸）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '产品体积', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品体积"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."产品体积"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品体积"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '产品重量', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品重量"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."产品重量"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品重量"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '产品实物图', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品实物图"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."产品实物图"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品实物图"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '包裹尺寸-长（厘米）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹尺寸-长（厘米）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."包裹尺寸-长（厘米）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹尺寸-长（厘米）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '包裹尺寸-宽（厘米）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹尺寸-宽（厘米）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."包裹尺寸-宽（厘米）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹尺寸-宽（厘米）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '包裹尺寸-高（厘米）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹尺寸-高（厘米）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."包裹尺寸-高（厘米）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹尺寸-高（厘米）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '包裹体积（立方厘米）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹体积（立方厘米）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."包裹体积（立方厘米）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹体积（立方厘米）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '体积重系数', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."体积重系数"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."体积重系数"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."体积重系数"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '体积重', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."体积重"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."体积重"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."体积重"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '包裹实重（公斤）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹实重（公斤）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."包裹实重（公斤）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹实重（公斤）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '包裹计费重', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹计费重"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."包裹计费重"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹计费重"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '包裹计费重（磅）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹计费重（磅）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."包裹计费重（磅）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹计费重（磅）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '包裹尺寸-长（英寸）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹尺寸-长（英寸）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."包裹尺寸-长（英寸）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹尺寸-长（英寸）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '包裹尺寸-宽（英寸）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹尺寸-宽（英寸）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."包裹尺寸-宽（英寸）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹尺寸-宽（英寸）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '包裹尺寸-高（英寸）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹尺寸-高（英寸）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."包裹尺寸-高（英寸）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹尺寸-高（英寸）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '包裹实物包装图', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹实物包装图"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."包裹实物包装图"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."包裹实物包装图"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '箱规', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."箱规"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."箱规"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."箱规"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '运输包装尺寸-长（厘米）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运输包装尺寸-长（厘米）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."运输包装尺寸-长（厘米）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运输包装尺寸-长（厘米）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '运输包装尺寸-宽（厘米）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运输包装尺寸-宽（厘米）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."运输包装尺寸-宽（厘米）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运输包装尺寸-宽（厘米）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '运输包装尺寸-高（厘米）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运输包装尺寸-高（厘米）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."运输包装尺寸-高（厘米）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运输包装尺寸-高（厘米）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '运输包装体积', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运输包装体积"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."运输包装体积"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运输包装体积"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '运输包装体积系数', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运输包装体积系数"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."运输包装体积系数"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运输包装体积系数"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '运输包装体积重', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运输包装体积重"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."运输包装体积重"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运输包装体积重"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '运输包装实重', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运输包装实重"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."运输包装实重"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运输包装实重"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '运输包装计费重', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运输包装计费重"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."运输包装计费重"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运输包装计费重"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '产品单价', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品单价"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."产品单价"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."产品单价"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '起订量', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."起订量"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."起订量"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."起订量"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '优惠政策', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."优惠政策"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."优惠政策"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."优惠政策"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '交货周期', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."交货周期"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."交货周期"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."交货周期"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '资质情况', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."资质情况"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."资质情况"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."资质情况"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '专利情况', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."专利情况"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."专利情况"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."专利情况"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '工厂所在地', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."工厂所在地"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."工厂所在地"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."工厂所在地"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '工厂联系人', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."工厂联系人"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."工厂联系人"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."工厂联系人"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '联系人电话', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."联系人电话"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."联系人电话"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."联系人电话"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '海外仓（卸货费）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."海外仓（卸货费）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."海外仓（卸货费）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."海外仓（卸货费）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '海外仓（操作费）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."海外仓（操作费）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."海外仓（操作费）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."海外仓（操作费）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '派送费（需要测试？）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."派送费（需要测试？）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."派送费（需要测试？）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."派送费（需要测试？）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '美元汇率', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."美元汇率"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."美元汇率"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."美元汇率"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '尾程成本（人民币）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."尾程成本（人民币）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."尾程成本（人民币）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."尾程成本（人民币）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '头程单价（人民币）？', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."头程单价（人民币）？"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."头程单价（人民币）？"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."头程单价（人民币）？"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '头程成本', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."头程成本"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."头程成本"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."头程成本"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '采购成本', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."采购成本"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."采购成本"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."采购成本"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '负向成本', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."负向成本"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."负向成本"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."负向成本"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '成本总计', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."成本总计"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."成本总计"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."成本总计"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '人民币报价', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."人民币报价"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."人民币报价"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."人民币报价"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, 'temu核价最低标准（未加2.99）', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."temu核价最低标准（未加2.99）"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."temu核价最低标准（未加2.99）"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."temu核价最低标准（未加2.99）"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, 'temu报价', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."temu报价"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."temu报价"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."temu报价"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, 'temu售价', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."temu售价"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."temu售价"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."temu售价"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '卖价', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."卖价"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."卖价"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."卖价"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '状态', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."状态"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."状态"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."状态"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '运营人员', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运营人员"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."运营人员"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."运营人员"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '创建时间', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."创建时间"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."创建时间"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."创建时间"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);

INSERT INTO purchase_record_fields (purchase_record_id, field_key, field_value)
SELECT id, '最后更新时间', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."最后更新时间"')), '')
FROM purchase_records
WHERE JSON_EXTRACT(data, '$."最后更新时间"') IS NOT NULL
  AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$."最后更新时间"')), '') IS NOT NULL
ON DUPLICATE KEY UPDATE field_value = VALUES(field_value);
