import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCollectionTree,
  collectionPath,
  collectionSubtreeIds,
  flattenCollectionTree,
} from "../src/lib/collections.ts";

const collections = [
  { id: "b", name: "B", parentId: null, position: 1 },
  { id: "a2", name: "A2", parentId: "a", position: 1 },
  { id: "a", name: "A", parentId: null, position: 0 },
  { id: "a1", name: "A1", parentId: "a", position: 0 },
];

test("collection helpers preserve hierarchy and sibling order", () => {
  const tree = buildCollectionTree(collections);
  assert.deepEqual(flattenCollectionTree(tree).map(({ collection, depth }) => [collection.id, depth]), [
    ["a", 0], ["a1", 1], ["a2", 1], ["b", 0],
  ]);
  assert.deepEqual(collectionPath(collections, "a2").map((item) => item.id), ["a", "a2"]);
  assert.deepEqual([...collectionSubtreeIds(collections, "a")].sort(), ["a", "a1", "a2"]);
});
