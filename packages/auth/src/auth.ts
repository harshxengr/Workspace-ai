import "dotenv/config";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@workspace/db";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:4000",

  trustedOrigins: [
    "http://localhost:3000",
    "http://localhost:4000",
  ],

  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  user: {
    modelName: "User",
  },

  emailAndPassword: {
    enabled: true,
  },

  advanced: {
    disableOriginCheck: true,
  },
});