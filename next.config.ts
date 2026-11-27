import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['exceljs', 'nodemailer'],
  experimental: { serverActions: { bodySizeLimit: '21mb' } }, // 20 MB documents + form overhead
  // notification links created by the database use role-specific paths
  async redirects() {
    return ['amo', 'hospital', 'finance'].map((r) => ({ source: `/${r}/bills/:id`, destination: '/bills/:id', permanent: false }));
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
