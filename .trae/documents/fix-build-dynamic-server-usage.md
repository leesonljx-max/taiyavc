# 修复 v1.0 部署构建错误

## 问题分析

构建过程中出现 "Dynamic server usage" 错误，涉及 3 个 API 路由：
- `/api/dashboard` — 使用 `getServerSession`（间接读取 cookies/headers）
- `/api/news` — 同上
- `/api/project-leads/match` — 同上

**根本原因**：Next.js 14 在构建时会尝试静态生成没有动态参数的 API 路由。这些路由通过 `getServerSession` 间接使用了 `headers()`/`cookies()`，无法静态生成，触发错误。

**为什么其他路由没报错**：带 `[id]` 等动态参数的路由会被 Next.js 自动标记为动态，不会尝试静态生成。

## 修复方案

在所有使用 `getServerSession` 的 API 路由文件中添加 `export const dynamic = 'force-dynamic'`，明确告诉 Next.js 这些路由是动态的，不要尝试静态生成。

### 需要修改的文件（17 个无动态参数的 API 路由）

1. `src/app/api/dashboard/route.ts`
2. `src/app/api/news/route.ts`
3. `src/app/api/news/search/route.ts`
4. `src/app/api/news/sources/route.ts`
5. `src/app/api/news/keywords/route.ts`
6. `src/app/api/news/[id]/route.ts`（虽然有 [id]，但保险起见也加上）
7. `src/app/api/projects/route.ts`
8. `src/app/api/project-leads/route.ts`
9. `src/app/api/project-leads/match/route.ts`
10. `src/app/api/user/avatar/route.ts`
11. `src/app/api/user/password/route.ts`
12. `src/app/api/user/profile/route.ts`
13. `src/app/api/admin/users/route.ts`
14. `src/app/api/statistics/financing-heatmap/route.ts`
15. `src/app/api/statistics/industry-map/route.ts`
16. `src/app/api/stage-change-requests/route.ts`
17. `src/app/api/users/managers/route.ts`
18. `src/app/api/upload/image/route.ts`

### 具体操作

**在服务器上执行**（不需要本地修改）：

```bash
cd /root/investrask

# 在所有 src/app/api 下的 route.ts 文件第一行添加 export const dynamic = 'force-dynamic'
find src/app/api -name "route.ts" -exec sed -i '1i export const dynamic = '"'"'force-dynamic'"'"'\n' {} \;

# 确认修改成功（抽查几个文件）
head -2 src/app/api/dashboard/route.ts
head -2 src/app/api/news/route.ts
head -2 src/app/api/projects/route.ts

# 清理缓存并重新构建
rm -rf .next
npm run build
```

### 验证

构建成功后，应该看到：
- `✓ Compiled successfully`
- `Skipping validation of types`
- `Skipping linting`
- `✓ Collecting page data`
- `✓ Generating static pages`
- **不再出现 "Dynamic server usage" 错误**
- `✓ Build completed`

构建成功后执行：
```bash
pm2 restart investrask --update-env
pm2 logs investrask --lines 20
```

然后在浏览器访问 `http://43.139.59.223:3000` 验证功能。
