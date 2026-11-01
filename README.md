# tools.liuxs.pro

工具箱站点（pnpm workspace）。

## 应用

- `apps/web`：Astro + React 静态站点，当前路由：
  - `/create-boundary/` 地块边界生成器（CSV / KML / KMZ → CGCS2000 Shapefile ZIP，支持多文件合并，全部在浏览器内完成）
- `apps/cli`：命令行工具 `@liuxspro/create-boundary-cli`（发布到 npm），同一套核心库，
  用于批量/脚本化生成边界 ZIP

## 开发

```bash
pnpm install
pnpm dev          # http://localhost:4321/create-boundary/
pnpm build        # 静态产物在 apps/web/dist
pnpm check        # astro check（需 TypeScript 6）
pnpm web:test     # Web 端单元测试（node --test）
pnpm --filter @tools/web smoke

pnpm cli:build    # 打包 CLI 到 apps/cli/dist/cli.js
pnpm cli:test     # 构建后跑 CLI 端到端测试
```

## 说明

- 核心库 `@liuxspro/create-boundary` 通过 JSR 引入：Web 用 npm 兼容层
  （`@jsr/liuxspro__create-boundary`），CLI 用 `jsr:` 协议，registry 配置见根目录 `.npmrc`。
- 地图底图使用 Esri World Imagery，无需 key。
- 站点根路径暂无首页，直接访问 `/create-boundary/`。
- CLI 包名保持 `@liuxspro/create-boundary-cli`（已发布到 npm），Mono
  仓库里按包名过滤：`pnpm --filter @liuxspro/create-boundary-cli <script>`。
