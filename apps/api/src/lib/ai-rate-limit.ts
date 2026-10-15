const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;

const requestTimestamps = new Map<string, number[]>();

export function allowAiRequest(
  userId: string,
  now = Date.now(),
): boolean {
  const cutoff = now - WINDOW_MS;

  const recentRequests = (requestTimestamps.get(userId) ?? [])
    .filter((timestamp) => timestamp > cutoff);

  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    requestTimestamps.set(userId, recentRequests);
    return false;
  }

  recentRequests.push(now);
  requestTimestamps.set(userId, recentRequests);

  // Avoid retaining an unlimited number of inactive user entries.
  if (requestTimestamps.size > 5_000) {
    for (const [key, timestamps] of requestTimestamps) {
      if (!timestamps.some((timestamp) => timestamp > cutoff)) {
        requestTimestamps.delete(key);
      }
    }
  }

  return true;
}