import { expect, test } from "bun:test";

import { allowAiRequest } from "./ai-rate-limit";

test("limits a user to ten AI requests in a rolling minute", () => {
  const userId = `ai-limit-test-${crypto.randomUUID()}`;
  const start = 1_000_000;

  for (let index = 0; index < 10; index += 1) {
    expect(allowAiRequest(userId, start + index * 100)).toBe(true);
  }

  expect(allowAiRequest(userId, start + 1_001)).toBe(false);

  // Old requests expire from the rolling window.
  expect(allowAiRequest(userId, start + 60_001)).toBe(true);
});