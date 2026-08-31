export interface CollectionLike {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
}

export type CollectionTreeNode<T extends CollectionLike = CollectionLike> = T & {
  children: CollectionTreeNode<T>[];
};

const byPosition = <T extends CollectionLike>(a: T, b: T) =>
  a.position - b.position || a.name.localeCompare(b.name);

export function buildCollectionTree<T extends CollectionLike>(collections: T[]): CollectionTreeNode<T>[] {
  const nodes = new Map(collections.map((collection) => [collection.id, { ...collection, children: [] } as CollectionTreeNode<T>]));
  const roots: CollectionTreeNode<T>[] = [];

  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent && parent !== node ? parent.children : roots).push(node);
  }
  const sort = (items: CollectionTreeNode<T>[]) => {
    items.sort(byPosition);
    items.forEach((item) => sort(item.children));
  };
  sort(roots);
  return roots;
}

export function flattenCollectionTree<T extends CollectionLike>(tree: CollectionTreeNode<T>[]) {
  const result: Array<{ collection: T; depth: number }> = [];
  const visit = (nodes: CollectionTreeNode<T>[], depth: number) => {
    for (const node of nodes) {
      result.push({ collection: node, depth });
      visit(node.children, depth + 1);
    }
  };
  visit(tree, 0);
  return result;
}

export function projectCollectionMove<T extends CollectionLike>(
  collections: T[],
  id: string,
  parentId: string | null,
  beforeId: string | null,
): T[] {
  const moving = collections.find((collection) => collection.id === id);
  if (!moving || parentId === id || beforeId === id) return collections;

  const target = collections
    .filter((collection) => collection.parentId === parentId && collection.id !== id)
    .sort(byPosition);
  const insertAt = beforeId ? target.findIndex((collection) => collection.id === beforeId) : target.length;
  if (insertAt < 0) return collections;
  target.splice(insertAt, 0, moving);

  const positions = new Map(target.map((collection, position) => [collection.id, { parentId, position }]));
  if (moving.parentId !== parentId) {
    collections
      .filter((collection) => collection.parentId === moving.parentId && collection.id !== id)
      .sort(byPosition)
      .forEach((collection, position) => positions.set(collection.id, { parentId: moving.parentId, position }));
  }

  let changed = false;
  const projected = collections.map((collection) => {
    const next = positions.get(collection.id);
    if (!next || (collection.parentId === next.parentId && collection.position === next.position)) return collection;
    changed = true;
    return { ...collection, ...next };
  });
  return changed ? projected : collections;
}

export function collectionSubtreeIds(collections: CollectionLike[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const collection of collections) {
    if (!collection.parentId) continue;
    const ids = children.get(collection.parentId) ?? [];
    ids.push(collection.id);
    children.set(collection.parentId, ids);
  }
  const result = new Set<string>();
  const visit = (current: string) => {
    if (result.has(current)) return;
    result.add(current);
    children.get(current)?.forEach(visit);
  };
  visit(id);
  return result;
}

export function collectionPath<T extends CollectionLike>(collections: T[], id: string): T[] {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const path: T[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}
