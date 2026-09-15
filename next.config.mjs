/** @type {import('next').NextConfig} */
const extractApiBaseUrl = process.env.EXTRACT_API_BASE_URL || 'http://127.0.0.1:8000';

const nextConfig = {
  async rewrites() {
    return [{ source: '/extract-api/:path*', destination: `${extractApiBaseUrl}/:path*` }];
  },
};

export default nextConfig;
