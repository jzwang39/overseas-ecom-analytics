ALTER TABLE workspace_records
  ADD COLUMN abandon_reason TEXT NULL;

UPDATE workspace_records
SET abandon_reason = NULLIF(
  JSON_UNQUOTE(JSON_EXTRACT(data, '$."放弃理由"')),
  ''
)
WHERE abandon_reason IS NULL
  AND JSON_EXTRACT(data, '$."放弃理由"') IS NOT NULL;
