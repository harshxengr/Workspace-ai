/**
 * Preserve similarity ranking while preventing a single long document from
 * dominating a workspace's retrieval results.
 */
export function diversifyByDocument<T extends { documentId: string }>(
  rows: T[],
  maxChunksPerDocument = 2,
): T[] {
  if (!Number.isInteger(maxChunksPerDocument) || maxChunksPerDocument < 1) {
    throw new RangeError("maxChunksPerDocument must be a positive integer");
  }

  const counts = new Map<string, number>();
  const diversified: T[] = [];

  for (const row of rows) {
    const count = counts.get(row.documentId) ?? 0;

    if (count >= maxChunksPerDocument) {
      continue;
    }

    counts.set(row.documentId, count + 1);
    diversified.push(row);
  }

  return diversified;
}
