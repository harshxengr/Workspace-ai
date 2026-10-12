import "dotenv/config";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { prisma } from "@workspace/db";
import { getWebOrigins } from "./origins";

const baseURL = process.env.BETTER_AUTH_URL || "http://localhost:4000";

const parsedBaseURL = new URL(baseURL);

if (
  process.env.NODE_ENV === "production" &&
  parsedBaseURL.protocol !== "https:"
) {
  throw new Error("BETTER_AUTH_URL must use HTTPS in production.");
}

const trustedOrigins = [...new Set([parsedBaseURL.origin, ...getWebOrigins()])];

export const auth = betterAuth({
  baseURL,

  trustedOrigins,

  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  user: {
    modelName: "User",
  },

  emailAndPassword: {
    enabled: true,
  },
});
