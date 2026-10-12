export type WebOriginEnvironment = {
  NODE_ENV?: string;
  WEB_ORIGINS?: string;
};

const DEVELOPMENT_WEB_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Returns the explicit browser origins permitted to access the application.
 *
 * Development receives safe local defaults. Production must provide an
 * explicit allowlist and use HTTPS for non-local origins.
 */
export function getWebOrigins(
  env: WebOriginEnvironment = process.env,
): string[] {
  const rawOrigins = env.WEB_ORIGINS?.trim();

  if (!rawOrigins) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "WEB_ORIGINS must be configured explicitly in production.",
      );
    }

    return [...DEVELOPMENT_WEB_ORIGINS];
  }

  const origins = rawOrigins
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      let url: URL;

      try {
        url = new URL(entry);
      } catch {
        throw new Error(
          `Invalid WEB_ORIGINS entry "${entry}". Use a complete HTTP or HTTPS origin.`,
        );
      }

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`WEB_ORIGINS entry "${entry}" must use HTTP or HTTPS.`);
      }

      if (
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      ) {
        throw new Error(
          `WEB_ORIGINS entry "${entry}" must contain an origin only, without a path, credentials, query, or fragment.`,
        );
      }

      if (env.NODE_ENV === "production") {
        if (LOOPBACK_HOSTNAMES.has(url.hostname)) {
          throw new Error(
            "WEB_ORIGINS must not contain localhost or loopback origins in production.",
          );
        }

        if (url.protocol !== "https:") {
          throw new Error(
            `Production WEB_ORIGINS entry "${entry}" must use HTTPS.`,
          );
        }
      }

      return url.origin;
    });

  if (origins.length === 0) {
    throw new Error("WEB_ORIGINS must contain at least one valid origin.");
  }

  return [...new Set(origins)];
}
