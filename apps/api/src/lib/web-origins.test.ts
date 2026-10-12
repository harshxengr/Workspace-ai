import { describe, expect, test } from "bun:test";

import { getWebOrigins } from "../../../../packages/auth/src/origins";

describe("getWebOrigins", () => {
  test("uses local development defaults outside production", () => {
    expect(
      getWebOrigins({
        NODE_ENV: "test",
      }),
    ).toEqual(["http://localhost:3000", "http://127.0.0.1:3000"]);
  });

  test("normalizes and deduplicates configured origins", () => {
    expect(
      getWebOrigins({
        NODE_ENV: "development",
        WEB_ORIGINS:
          "https://app.example.com/, https://admin.example.com, https://app.example.com",
      }),
    ).toEqual(["https://app.example.com", "https://admin.example.com"]);
  });

  test("rejects entries containing a path", () => {
    expect(() =>
      getWebOrigins({
        NODE_ENV: "development",
        WEB_ORIGINS: "https://app.example.com/settings",
      }),
    ).toThrow(/origin only/);
  });

  test("rejects non-HTTP protocols", () => {
    expect(() =>
      getWebOrigins({
        NODE_ENV: "development",
        WEB_ORIGINS: "file:///tmp/app",
      }),
    ).toThrow(/HTTP or HTTPS/);
  });

  test("requires an explicit allowlist in production", () => {
    expect(() =>
      getWebOrigins({
        NODE_ENV: "production",
      }),
    ).toThrow(/WEB_ORIGINS must be configured/);
  });

  test("rejects plain HTTP origins in production", () => {
    expect(() =>
      getWebOrigins({
        NODE_ENV: "production",
        WEB_ORIGINS: "http://app.example.com",
      }),
    ).toThrow(/must use HTTPS/);
  });

  test("rejects localhost origins in production", () => {
    expect(() =>
      getWebOrigins({
        NODE_ENV: "production",
        WEB_ORIGINS: "https://localhost:3000",
      }),
    ).toThrow(/must not contain localhost/);
  });

  test("rejects a configured list with no valid entries", () => {
    expect(() =>
      getWebOrigins({
        NODE_ENV: "development",
        WEB_ORIGINS: ", , ",
      }),
    ).toThrow(/at least one valid origin/);
  });
});
