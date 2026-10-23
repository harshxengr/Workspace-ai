import { expect, test } from "bun:test";

import {
  AI_REQUEST_LIMIT_PER_WINDOW,
  AI_REQUEST_WINDOW_SECONDS,
  isAiRequestLimitReached,
} from "./ai-rate-limit";

test("uses a ten-request rolling window with a sixty-second duration", () => {
  expect(AI_REQUEST_LIMIT_PER_WINDOW).toBe(10);
  expect(AI_REQUEST_WINDOW_SECONDS).toBe(60);
});

test("only blocks requests once the allowed request count has been reached", () => {
  expect(isAiRequestLimitReached(0)).toBe(false);
  expect(isAiRequestLimitReached(9)).toBe(false);
  expect(isAiRequestLimitReached(10)).toBe(true);
  expect(isAiRequestLimitReached(11)).toBe(true);
});
