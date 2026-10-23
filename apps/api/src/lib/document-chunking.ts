export const MAX_DOCUMENT_TEXT_CHARACTERS = 24_000;
export const DOCUMENT_CHUNK_SIZE = 1_800;
export const DOCUMENT_CHUNK_OVERLAP = 240;

function findChunkEnd(
  text: string,
  start: number,
  proposedEnd: number,
): number {
  const minimumBoundary =
    start + Math.floor((proposedEnd - start) * 0.65);

  const paragraphBreak = text.lastIndexOf("\n\n", proposedEnd);

  if (paragraphBreak >= minimumBoundary) {
    return paragraphBreak;
  }

  const lineBreak = text.lastIndexOf("\n", proposedEnd);

  if (lineBreak >= minimumBoundary) {
    return lineBreak;
  }

  const wordBoundary = text.lastIndexOf(" ", proposedEnd);

  if (wordBoundary >= minimumBoundary) {
    return wordBoundary;
  }

  return proposedEnd;
}

export function chunkDocumentText(input: string): string[] {
  const text = input
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!text) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + DOCUMENT_CHUNK_SIZE, text.length);

    if (end < text.length) {
      end = findChunkEnd(text, start, end);
    }

    const chunk = text.slice(start, end).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= text.length) {
      break;
    }

    let nextStart = Math.max(
      start + 1,
      end - DOCUMENT_CHUNK_OVERLAP,
    );

    // Avoid beginning the next chunk in the middle of a word.
    while (
      nextStart < end &&
      nextStart < text.length &&
      !/\s/.test(text[nextStart]!)
    ) {
      nextStart += 1;
    }

    while (nextStart < text.length && /\s/.test(text[nextStart]!)) {
      nextStart += 1;
    }

    if (nextStart <= start) {
      nextStart = end;
    }

    start = nextStart;
  }

  return chunks;
}