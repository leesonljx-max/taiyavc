/**
 * next/font Google Fonts 离线构建 Mock（本机/内网无法访问 fonts.googleapis.com 时使用）
 *
 * 用法（网络正常时无需使用，走真实字体）：
 *   NEXT_FONT_GOOGLE_MOCKED_RESPONSES=$(pwd)/scripts/google-fonts-mock.js npm run build
 *
 * 原理：Next.js 内置 NEXT_FONT_GOOGLE_MOCKED_RESPONSES 环境变量（指向本文件），
 * 按请求 URL 返回 Mock CSS；字体文件不再联网，直接以 URL 内容占位自托管输出。
 */

/* latin */
const interLatin = `/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v13/mock-inter-latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
`

module.exports = {
  // src/app/layout.tsx: Inter({ subsets: ['latin'] }) → 变量字重请求 URL
  'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap': interLatin,
}
