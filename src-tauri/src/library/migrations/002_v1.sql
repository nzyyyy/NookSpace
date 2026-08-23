ALTER TABLE items ADD COLUMN extracted_text TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN extracted_at TEXT;
ALTER TABLE items ADD COLUMN extraction_error TEXT;

CREATE INDEX idx_items_type_created ON items(type, created_at DESC);

CREATE TABLE saved_views (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  query         TEXT NOT NULL,
  sort          TEXT NOT NULL CHECK (sort IN ('updated', 'created', 'title', 'type')),
  view          TEXT NOT NULL CHECK (view IN ('all', 'favorites', 'recent', 'uncollected', 'collection', 'tag')),
  collection_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
  tag_id        TEXT REFERENCES tags(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  CHECK (
    (view = 'collection' AND collection_id IS NOT NULL AND tag_id IS NULL) OR
    (view = 'tag' AND tag_id IS NOT NULL AND collection_id IS NULL) OR
    (view NOT IN ('collection', 'tag') AND collection_id IS NULL AND tag_id IS NULL)
  )
);

CREATE VIRTUAL TABLE items_fts USING fts5(
  title,
  content,
  url,
  extracted_text,
  content='items',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER items_fts_insert AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, title, content, url, extracted_text)
  VALUES (new.rowid, new.title, new.content, new.url, new.extracted_text);
END;

CREATE TRIGGER items_fts_delete AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, content, url, extracted_text)
  VALUES ('delete', old.rowid, old.title, old.content, old.url, old.extracted_text);
END;

CREATE TRIGGER items_fts_update AFTER UPDATE OF title, content, url, extracted_text ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, content, url, extracted_text)
  VALUES ('delete', old.rowid, old.title, old.content, old.url, old.extracted_text);
  INSERT INTO items_fts(rowid, title, content, url, extracted_text)
  VALUES (new.rowid, new.title, new.content, new.url, new.extracted_text);
END;

INSERT INTO items_fts(items_fts) VALUES ('rebuild');
