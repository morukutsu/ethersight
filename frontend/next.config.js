/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    swcMinify: true,
    async rewrites() {
        return [
            {
                source: "/api/:path*",
                destination: `http://localhost:3344/:path*`,
            },
        ];
    },
};

module.exports = nextConfig;
