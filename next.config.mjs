/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  experimental: {
    serverComponentsExternalPackages: ["pg", "pdf-parse"],
    instrumentationHook: true,
  },
};

export default nextConfig;
