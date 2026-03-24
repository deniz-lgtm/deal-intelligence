/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  experimental: {
    serverComponentsExternalPackages: ["pg", "pdf-parse"],
    instrumentationHook: true,
  },
};

export default nextConfig;
