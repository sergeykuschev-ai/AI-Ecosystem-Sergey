/**
 * Normalization layer for Directus responses.
 *
 * Components and pages consume stable domain objects only. These helpers hide
 * Directus file objects, relation objects, and junction arrays behind the
 * plain strings and URLs defined in `types/`.
 */

export interface DirectusFile {
  id: string;
  filename_download?: string;
  type?: string;
}

export interface DirectusRelation {
  id: string;
  [key: string]: unknown;
}

export interface DirectusM2MItem<T = DirectusRelation> {
  id?: string;
  [collectionId: string]: T | string | undefined;
}

export function getDirectusAssetUrl(fileId: string | null | undefined): string | null {
  if (!fileId) return null;
  return `/api/assets/${fileId}`;
}

export function normalizeFile(file: DirectusFile | string | null | undefined): string | null {
  if (!file) return null;
  const id = typeof file === "string" ? file : file.id;
  return getDirectusAssetUrl(id);
}

export function normalizeFileId(file: DirectusFile | string | null | undefined): string | null {
  if (!file) return null;
  return typeof file === "string" ? file : file.id;
}

export function normalizeRelationId(relation: DirectusRelation | string | null | undefined): string | null {
  if (!relation) return null;
  return typeof relation === "string" ? relation : relation.id;
}

export function normalizeM2MIds<T extends DirectusRelation>(
  items: Array<DirectusM2MItem<T>> | null | undefined,
  relationField: string,
): string[] {
  if (!items || !items.length) return [];
  return items
    .map((item) => {
      const value = item[relationField];
      if (!value) return null;
      return typeof value === "string" ? value : value.id;
    })
    .filter((id): id is string => Boolean(id));
}
