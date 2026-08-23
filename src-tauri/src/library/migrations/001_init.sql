-- 001_init: initial schema
CREATE TABLE items (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL CHECK (type IN ('note', 'file', 'link')),
  title          TEXT NOT NULL DEFAULT '',
  content        TEXT NOT NULL DEFAULT '',
  url            TEXT NOT NULL DEFAULT '',
  stored_path    TEXT NOT NULL DEFAULT '',
  size           INTEGER NOT NULL DEFAULT 0,
  mime           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  last_opened_at TEXT NOT NULL DEFAULT '',
  deleted_at     TEXT,
  is_favorite    INTEGER NOT NULL DEFAULT 0,
  meta           TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_items_updated ON items(updated_at DESC);
CREATE INDEX idx_items_deleted ON items(deleted_at);
CREATE INDEX idx_items_favorite ON items(is_favorite);

CREATE TABLE collections (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE item_collections (
  item_id       TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, collection_id)
);
CREATE INDEX idx_item_collections_col ON item_collections(collection_id);
CREATE INDEX idx_item_collections_item ON item_collections(item_id);

CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color      TEXT,
  emoji      TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE item_tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX idx_item_tags_tag ON item_tags(tag_id);
CREATE INDEX idx_item_tags_item ON item_tags(item_id);

CREATE TABLE attachments (
  parent_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  child_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (parent_id, child_id)
);
