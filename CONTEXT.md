# NookSpace — Domain Glossary (领域词汇表)

Canonical terms are English; 中文 glosses are for the team's shared vocabulary.
This file is a glossary only — no implementation details.

## Core

- **Library (资料库)** — the single container of everything the user keeps in
  NookSpace: Notes, Files, Links and their organization. Conceptually the
  user's whole workspace; physically an app-managed directory plus an index.
  The user never edits the Library outside the app.

- **Item (条目)** — the single unified record. An Item has exactly one type:
  Note, File, or Link. All organization, search, favorites, recents and trash
  operate on Items uniformly.

## Item types

- **Note (笔记)** — an Item whose substance is Markdown text.

- **File (文件)** — an Item that wraps a stored file (a copy inside the
  Library). Distinct from:
  - **Source file (源文件)** — the original file outside the Library that was
    imported; it is never modified or deleted by the app.
  - **Stored file (库内文件)** — the copy managed by the app inside the
    Library directory.

- **Link (链接)** — an Item wrapping a URL and a title.

- **Attachment (附件)** — a relationship in which one Item (typically a Note)
  references another Item (typically a File). An Attachment is not an Item
  type. v1 restricts Attachments to Note → File.

## Organization

- **Collection (集合)** — a user-managed grouping of Items. An Item may belong
  to any number of Collections. Collections are flat in v1; hierarchy
  (`parent_id`) is reserved, not implemented.

- **Tag (标签)** — a lightweight keyword attached to Items. Flat in v1;
  color/emoji columns are reserved, not implemented.

- **Smart View (智能视图)** — a built-in, computed view, not user-editable:
  Favorites (收藏), Recent (最近), Uncollected (未分类). Contrast with
  Collection and Tag, which users manage.

- **Favorite (收藏)** — a boolean state of an Item. "Favorites" is the Smart
  View of favorited Items.

- **Recent (最近)** — the Smart View of Items ordered by last opened (open,
  preview, or edit updates it).

- **Uncollected (未分类)** — the Smart View of Items belonging to no
  Collection. An Item in at least one Collection is not Uncollected, even if
  it feels unorganized.

## Lifecycle & actions

- **Trash (回收站)** — soft-deleted Items (`deleted_at`). Restore brings an
  Item back; Empty destroys the underlying stored files.

- **Import (导入)** — copying Source files into the Library as stored files
  and creating File Items. Never touches Source files.

- **Preview (快速查看)** — in-app quick view of an Item via Space, without
  opening its full detail.

- **Command Palette (命令面板)** — the Cmd+K global search and action surface.
