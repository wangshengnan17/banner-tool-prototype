# Banner-PB 系统审计报告

**日期**: 2026-07-10  
**审计范围**: 输入输出记录、考评打分、Makefile、用户体系

---

## 1. 输入输出记录机制 ✅（部分完成，有缺口）

### 现状

| 环节 | 记录方式 | 存储位置 | 状态 |
|------|---------|---------|------|
| 用户输入（提示词/模型/文案） | `saveGeneration()` → `POST /api/custom/generations/save` | `generation_configs` 表 | ✅ |
| 生成结果（氛围图/尺寸图） | 同上 | `generation_results` 表 | ✅ |
| 迭代创建 | `createNextIteration()` | `iterations` 表 | ✅ |
| AI 打分结果 | `saveEvaluation()` | `evaluations` 表 | ✅ |
| 参考图 | 前端 state，未持久化 | — | ⚠️ 未入库 |
| **无迭代时的生成** | **不保存** | — | ❌ 缺口 |
| **Vite dev server 代理生成** | **不保存** | — | ❌ 缺口 |

### 发现的问题

**问题 1：无迭代时生成不保存**
`src/App.jsx` 第 1524 行：
```js
if (iteration && !testSingle) {
  const saved = await saveGeneration({...});
}
```
当 `iteration` 为 null（用户用前端 Vite 代理直接生成，未连接 PocketBase）时，所有生成结果丢失。

**问题 2：参考图未入库**
用户上传的参考图（referenceImage）存在前端 state 中，刷新即丢失。`generation_configs` 表有 `reference_image` 文件字段但未被使用。

**问题 3：Vite dev server 的 `/api/generate-images` 是纯代理**
`vite.config.mjs` 中的 `imageGenerationMiddleware()` 只做 API 转发，不写数据库。

### 建议

1. 生成按钮统一走 PocketBase 后端 `/api/custom/generate-images`，废弃 Vite 代理（或让 Vite 代理也转发到后端）
2. 保存参考图到 `generation_configs.reference_image`
3. 前端检测 PocketBase 连接状态，未连接时给出提示

---

## 2. 考评打分机制 ✅（已实现，需验证）

### 打分流程

```
用户点击「AI 打分」
  → IterationPanel.handleEvaluate()
  → evaluateImage({ imageSrc, scorerModel, prompt, title, subtitle, sizeKey })
  → POST /api/custom/evaluate-image
  → backend/evaluation.go:evaluateImage()
  → Chat Completions API（默认 gpt-4o）
  → 返回四维评分 JSON
  → saveEvaluation() 写入 evaluations 表
```

### 四个评分维度

| 维度 | 字段名 | 权重 | 说明 |
|------|--------|------|------|
| 构图 | compositionScore | 25% | 布局、主体突出、留白 |
| 色彩 | colorScore | 25% | 配色协调、促销氛围匹配 |
| 氛围 | atmosphereScore | 25% | 光效/粒子/3D |
| 商业感 | commercialScore | 25% | 视觉冲击力、点击吸引力 |
| 综合 | overallScore | 100% | 加权平均 |

### 发现的问题

**问题 4：打分模型需要配置**
`evaluation.go` 默认使用 `gpt-4o` 作为打分模型。如果 API Key 不完整（没有 NEW_API_KEY 或 OPENAI_API_KEY），打分失败。

**问题 5：打分仅对第一张结果图**
`IterationPanel.jsx` 第 125 行：`handleEvaluate(iterationResults[0])` — 只评估第一张图。

**问题 6：无模型配置时打分模型降级逻辑缺失**
`getApiCredentials()` 在没有 modelConfigId 时只查环境变量，环境变量缺失则直接报错。

### 验证方法

```bash
# 1. 确认后端运行
make status

# 2. 确认 API Key
echo $OPENAI_API_KEY    # 或 NEW_API_KEY / DASHSCOPE_API_KEY

# 3. 测试打分接口
curl -X POST http://127.0.0.1:8090/api/custom/evaluate-image \
  -H "Content-Type: application/json" \
  -d '{"imageSrc":"data:image/png;base64,...", "prompt":"测试", "scorerModel":"gpt-4o"}'
```

---

## 3. Makefile ✅（已创建）

`Makefile` 已创建，提供以下功能：

| 命令 | 用途 |
|------|------|
| `make dev` | 启动前后端 |
| `make tmux-dev` | tmux 分屏启动 |
| `make build` | 构建前后端 |
| `make start/stop/restart` | 服务管理 |
| `make status` | 查看运行状态 |
| `make logs` | 查看后端日志 |
| `make backup-db` | 备份数据库 |
| `make audit` | 运行自检 |
| `make fmt/lint` | 代码质量 |
| `make clean` | 清理产物 |

---

## 4. 用户/登录体系 ❌（未实现）

### 现状

- PocketBase 原生支持：email/password 注册登录、JWT token、OAuth2（Google/GitHub 等）
- 当前所有 collections 的 List/View/Create/Update/Delete 规则都是 `""`（空字符串 = 允许任何人）
- 前端 `pb.js` 只是初始化 PocketBase 客户端，无登录逻辑

### 设计方案

见 `LOGIN-DESIGN.md`。

---

## 总结

| 项目 | 状态 | 优先级 |
|------|------|--------|
| Makefile | ✅ 已完成 | — |
| 输入记录 | ⚠️ 有缺口 | 🔴 高 |
| 输出记录 | ⚠️ 有缺口 | 🔴 高 |
| 考评打分 | ✅ 已实现 | 🟡 需验证 |
| 登录体系 | ❌ 未实现 | 🟡 中 |
