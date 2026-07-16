# Banner-PB 系统设计文档

## 项目概述

基于 PocketBase Go 二次开发的 Banner 设计工具后端系统，将原有纯前端原型升级为具有数据持久化、素材管理、版本历史追踪能力的完整系统。

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│              Banner Tool Frontend (React 19 + Vite)          │
│              通过 PocketBase JS SDK 调用 API                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST API (http://127.0.0.1:8090/api/)
┌──────────────────────────▼──────────────────────────────────┐
│                PocketBase Backend (Go 1.26)                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  自定义 Go 路由                                          │ │
│  │  POST /api/bp/generate      图片生成代理（DashScope/OpenAI）│ │
│  │  POST /api/bp/save-results  生成结果入库（版本+候选图）    │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  5 个自定义 Collections（自动建表）                       │ │
│  │  projects → design_versions → design_candidates         │ │
│  │            → banner_outputs                             │ │
│  │  reference_images                                       │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  文件存储 (pb_data/storage)                              │ │
│  │  氛围图 · Banner JPG · 参考图                            │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Admin Dashboard (http://127.0.0.1:8090/_/)             │ │
│  │  可视化数据管理                                          │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 数据模型

### projects（项目）
| 字段 | 类型 | 说明 |
|------|------|------|
| name | text | 项目名称，如"618省钱卡-紫蓝霓虹" |
| status | select | draft / active / completed / archived |
| description | text | 项目描述 |

### design_versions（设计版本）
| 字段 | 类型 | 说明 |
|------|------|------|
| project | relation → projects | 所属项目 |
| version_number | number | 版本序号，自动递增 |
| prompt | text | 使用的提示词 |
| model | text | 使用的模型名 |
| api_mode | text | 生图 API 模式 |
| status | select | pending / generating / completed / failed |

### design_candidates（氛围图候选）
| 字段 | 类型 | 说明 |
|------|------|------|
| version | relation → design_versions | 所属版本 |
| candidate_index | number | 候选序号 1-4 |
| image_name | text | 图片名 |
| note | text | 备注 |
| selected | bool | 是否被选中 |
| image | file | 氛围图文件（PocketBase 文件存储） |

### banner_outputs（Banner 输出）
| 字段 | 类型 | 说明 |
|------|------|------|
| version | relation → design_versions | 所属版本 |
| template_key | text | 尺寸标识，如"398x225" |
| template_label | text | 尺寸标签 |
| width | number | 宽度 |
| height | number | 高度 |
| banner_image | file | 输出的 Banner JPG |
| candidate | relation → design_candidates | 使用的氛围图 |

### reference_images（参考图素材）
| 字段 | 类型 | 说明 |
|------|------|------|
| project | relation → projects | 所属项目 |
| name | text | 参考图名称 |
| image | file | 参考图文件 |

---

## 关系图

```
projects (1) ────< (N) design_versions (1) ────< (N) design_candidates
                      │                                    │
                      ├──< (N) banner_outputs ─────────────┘
                      │
projects (1) ────< (N) reference_images
```

---

## API 接口

### 标准 PocketBase REST API
| 端点 | 说明 |
|------|------|
| `GET /api/collections/projects/records` | 项目列表 |
| `POST /api/collections/projects/records` | 创建项目 |
| `GET /api/collections/design_versions/records?filter=(project='xxx')` | 某项目的版本历史 |
| `GET /api/collections/design_candidates/records?filter=(version='xxx')` | 某版本的候选图 |

### 自定义 API
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/bp/generate` | POST | 图片生成代理，支持 DashScope / OpenAI |
| `/api/bp/save-results` | POST | 接收生成结果，自动创建版本+候选图 |

---

## 支持的 AI 服务

| 服务 | apiMode | 模型示例 | Key 环境变量 |
|------|---------|---------|------------|
| 阿里 DashScope | `dashscope-wan` | `wan2.7-image-pro` 等 | `DASHSCOPE_API_KEY` |
| OpenAI Chat | `chat-completions` | `openai/gpt-5.4-image-2` | `OPENAI_API_KEY` |

---

## 环境配置

```bash
# .env
IMAGE_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_API_KEY=sk-your-key
```

---

## 启动方式

```bash
cd pb-backend
~/go/bin/go build -o banner-pb .
./banner-pb superuser create admin@banner.local your-password
./banner-pb serve --http=127.0.0.1:8090
# 管理后台: http://127.0.0.1:8090/_/
```

---

## 已验证

- ✅ Go 1.26.5 编译通过
- ✅ PocketBase v0.39.6 集成
- ✅ 5 个 Collections 自动建表 + 关系字段
- ✅ Superuser 创建
- ✅ Projects / Design Versions / Candidates 写入
- ✅ 自定义生图代理路由注册
- ✅ 服务启动正常
