/**
 * Deterministic UUID generation for repeatable seed runs.
 * Uses UUID v5 so the same slug always produces the same primary key.
 */

import { v5 as uuidv5 } from "uuid";

const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // DNS namespace

export function generateId(collection: string, slug: string): string {
  return uuidv5(`${collection}:${slug}`, NAMESPACE);
}
