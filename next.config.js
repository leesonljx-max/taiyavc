/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // pdf-parse v2 被 webpack 打包后运行时报
  // "Object.defineProperty called on non-object"，必须作为外部包原生加载
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse'],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    return [
      // 将 /avatars/、/project-docs/、/project-images/、/research-docs/ 的请求重写到 API 路由
      // 解决 Next.js 生产模式下运行时上传的文件无法通过静态文件服务访问的问题
      { source: '/avatars/:path*', destination: '/api/uploads/avatars/:path*' },
      { source: '/project-docs/:path*', destination: '/api/uploads/project-docs/:path*' },
      { source: '/project-images/:path*', destination: '/api/uploads/project-images/:path*' },
      { source: '/research-docs/:path*', destination: '/api/uploads/research-docs/:path*' },
    ]
  },
}

module.exports = nextConfig
