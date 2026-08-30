WITH RECURSIVE locked_collections(id) AS (
  SELECT id FROM collections WHERE is_locked = 1
  UNION
  SELECT c.id
  FROM collections c
  JOIN locked_collections parent ON c.parent_id = parent.id
)
UPDATE items
SET is_locked = 0
WHERE is_locked = 1
  AND id IN (
    SELECT ic.item_id
    FROM item_collections ic
    JOIN locked_collections collection ON collection.id = ic.collection_id
  );
