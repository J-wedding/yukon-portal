// Netlify Blobs stores. Tests can swap in an in-memory store via globalThis.__TEST_STORES.
import { getStore } from "@netlify/blobs";

export function store(name) {
  if (globalThis.__TEST_STORES) return globalThis.__TEST_STORES(name);
  return getStore({ name, consistency: "strong" });
}
