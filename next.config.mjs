/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3001";
    return [
      { source: "/api/:path*", destination: `${apiOrigin}/api/:path*` },
      { source: "/twilio/:path*", destination: `${apiOrigin}/twilio/:path*` }
    ];
  }
};

export default nextConfig;
