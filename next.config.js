/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    return [
      // 将 /avatars/、/project-docs/、/project-images/ 的请求重写到 API 路由
      // 解决 Next.js 生产模式下运行时上传的文件无法通过静态文件服务访问的问题
      { source: '/avatars/:path*', destination: '/api/uploads/avatars/:path*' },
      { source: '/project-docs/:path*', destination: '/api/uploads/project-docs/:path*' },
      { source: '/project-images/:path*', destination: '/api/uploads/project-images/:path*' },
    ]
  },
}

module.exports = nextConfig
