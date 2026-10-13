import process from "node:process";

/** @type {import('next').NextConfig} */
const apiProxyUrl = process.env.API_PROXY_URL?.replace(/\/+$/, "");

const nextConfig = {
  async rewrites() {
    if (!apiProxyUrl) {
      return [];
    }

    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
