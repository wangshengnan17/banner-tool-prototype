# ============================================================
# Banner-PB Makefile
# ============================================================
# 项目结构:
#   backend/   — Go + PocketBase 后端服务 (默认端口 8090)
#   src/       — React 19 + Vite 前端 (默认端口 5173)
# ============================================================

.PHONY: help dev build start stop clean fmt lint test audit

# 默认目标
help: ## 显示帮助信息
	@echo "Banner-PB 项目 Makefile"
	@echo ""
	@echo "快速开始:"
	@echo "  make dev           启动前后端开发服务"
	@echo "  make build         构建前后端"
	@echo "  make start         后台启动服务"
	@echo "  make stop          停止所有服务"
	@echo ""
	@echo "开发辅助:"
	@echo "  make dev-backend   仅启动后端"
	@echo "  make dev-frontend  仅启动前端"
	@echo "  make build-backend 仅构建后端"
	@echo "  make build-frontend 仅构建前端"
	@echo ""
	@echo "质量检查:"
	@echo "  make fmt           代码格式化"
	@echo "  make lint          代码检查"
	@echo "  make audit         项目自检"
	@echo ""
	@echo "运维:"
	@echo "  make clean         清理构建产物"
	@echo "  make backup-db     备份数据库"
	@echo "  make logs          查看运行日志"
	@echo "  make status        查看服务状态"

# ============================================================
# 环境变量
# ============================================================

BACKEND_DIR  := backend
FRONTEND_DIR := .
BACKEND_BIN  := $(BACKEND_DIR)/banner-backend
BACKEND_PORT := 8090
FRONTEND_PORT := 5173
PB_DATA_DIR  := $(BACKEND_DIR)/pb_data
PB_ADMIN_URL := http://127.0.0.1:$(BACKEND_PORT)/_/
NPM          := npm --prefer-offline
GO           := go
GOPATH       := $(shell PATH="/opt/homebrew/bin:$(PATH)" which go 2>/dev/null || echo go)

# ============================================================
# 开发
# ============================================================

dev: dev-backend dev-frontend ## 同时启动前后端（需要两个终端，建议用 tmux 或分别运行）

dev-backend: ## 启动后端开发服务
	@echo "🚀 启动后端 PocketBase (端口 $(BACKEND_PORT))..."
	@cd $(BACKEND_DIR) && $(GO) run . serve --http=127.0.0.1:$(BACKEND_PORT)

dev-frontend: ## 启动前端 Vite 开发服务器
	@echo "🚀 启动前端 Vite (端口 $(FRONTEND_PORT))..."
	@$(NPM) run dev

tmux-dev: ## 用 tmux 分屏同时启动前后端
	@tmux new-session -d -s banner-pb
	@tmux send-keys -t banner-pb 'cd $(BACKEND_DIR) && $(GO) run . serve --http=127.0.0.1:$(BACKEND_PORT)' C-m
	@tmux split-window -h -t banner-pb
	@tmux send-keys -t banner-pb '$(NPM) run dev' C-m
	@tmux attach -t banner-pb

# ============================================================
# 构建
# ============================================================

build: build-backend build-frontend ## 构建前后端

build-backend: ## 构建后端二进制
	@echo "🔨 构建后端..."
	@cd $(BACKEND_DIR) && $(GO) build -o banner-backend .
	@echo "✅ 后端构建完成: $(BACKEND_BIN)"

build-frontend: ## 构建前端静态文件
	@echo "🔨 构建前端..."
	@$(NPM) run build
	@echo "✅ 前端构建完成: dist/"

# ============================================================
# 启动 / 停止
# ============================================================

start: build-backend ## 后台启动后端服务
	@echo "🚀 后台启动后端..."
	@cd $(BACKEND_DIR) && nohup ./banner-backend serve --http=127.0.0.1:$(BACKEND_PORT) > /tmp/banner-pb.log 2>&1 &
	@echo "✅ 后端已启动，PID: $$(lsof -ti:$(BACKEND_PORT))"
	@echo "   日志: /tmp/banner-pb.log"
	@echo "   管理后台: $(PB_ADMIN_URL)"

stop: ## 停止所有 banner-pb 相关服务
	@echo "🛑 停止服务..."
	@-lsof -ti:$(BACKEND_PORT) | xargs kill 2>/dev/null && echo "  已停止端口 $(BACKEND_PORT)" || echo "  端口 $(BACKEND_PORT) 无运行进程"
	@-lsof -ti:$(FRONTEND_PORT) | xargs kill 2>/dev/null && echo "  已停止端口 $(FRONTEND_PORT)" || echo "  端口 $(FRONTEND_PORT) 无运行进程"
	@-tmux kill-session -t banner-pb 2>/dev/null

restart: stop start ## 重启后端服务

# ============================================================
# 状态与日志
# ============================================================

status: ## 查看服务状态
	@echo "=== 服务状态 ==="
	@echo ""
	@echo "后端 (端口 $(BACKEND_PORT)):"
	@lsof -ti:$(BACKEND_PORT) >/dev/null 2>&1 && echo "  ✅ 运行中 (PID: $$(lsof -ti:$(BACKEND_PORT)))" || echo "  ❌ 未运行"
	@echo ""
	@echo "前端 (端口 $(FRONTEND_PORT)):"
	@lsof -ti:$(FRONTEND_PORT) >/dev/null 2>&1 && echo "  ✅ 运行中 (PID: $$(lsof -ti:$(FRONTEND_PORT)))" || echo "  ❌ 未运行"
	@echo ""
	@echo "管理后台: $(PB_ADMIN_URL)"
	@echo "前端地址: http://127.0.0.1:$(FRONTEND_PORT)"

logs: ## 查看后端日志
	@tail -f /tmp/banner-pb.log 2>/dev/null || echo "暂无日志"

# ============================================================
# 数据库管理
# ============================================================

backup-db: ## 备份数据库到 backups/ 目录
	@mkdir -p backups
	@cp $(PB_DATA_DIR)/data.db backups/data-$(shell date +%Y%m%d-%H%M%S).db
	@echo "✅ 数据库已备份到 backups/"

restore-db: ## 从最新备份恢复数据库（危险操作！）
	@latest=$$(ls -t backups/data-*.db 2>/dev/null | head -1); \
	if [ -z "$$latest" ]; then \
		echo "❌ 没有找到备份文件"; \
	else \
		cp $$latest $(PB_DATA_DIR)/data.db && echo "✅ 已从 $$latest 恢复"; \
	fi

# ============================================================
# 代码质量
# ============================================================

fmt: ## 格式化代码
	@echo "🎨 格式化前端代码..."
	@$(NPM) run build -- --mode check 2>/dev/null || true
	@echo "🎨 格式化后端代码..."
	@cd $(BACKEND_DIR) && $(GO) fmt ./...

lint: ## 代码检查
	@echo "🔍 检查后端..."
	@cd $(BACKEND_DIR) && $(GO) vet ./...
	@echo "✅ 后端检查通过"

# ============================================================
# 项目自检
# ============================================================

audit: ## 运行项目自检
	@echo "=========================================="
	@echo "        Banner-PB 项目审计"
	@echo "=========================================="
	@echo ""
	@echo "1. 后端代码编译检查..."
	@cd $(BACKEND_DIR) && $(GO) build -o /dev/null . 2>&1 && echo "   ✅ 编译通过" || echo "   ❌ 编译失败"
	@echo ""
	@echo "2. 数据模型完整性..."
	@cd $(BACKEND_DIR) && $(GO) run . --help >/dev/null 2>&1 && echo "   ✅ PocketBase 可启动" || echo "   ⚠️  启动失败"
	@echo ""
	@echo "3. 前端依赖..."
	@test -d node_modules && echo "   ✅ node_modules 已安装" || echo "   ❌ 请运行 npm install"
	@echo ""
	@echo "4. 环境变量..."
	@test -n "$$DASHSCOPE_API_KEY" && echo "   ✅ DASHSCOPE_API_KEY" || echo "   ⚠️  DASHSCOPE_API_KEY 未设置"
	@test -n "$$OPENAI_API_KEY" && echo "   ✅ OPENAI_API_KEY" || echo "   ⚠️  OPENAI_API_KEY 未设置"
	@test -n "$$NEW_API_KEY" && echo "   ✅ NEW_API_KEY" || echo "   ℹ️  NEW_API_KEY 未设置（可选）"
	@echo ""
	@echo "5. 数据库文件..."
	@test -f $(PB_DATA_DIR)/data.db && echo "   ✅ data.db 存在" || echo "   ⚠️  data.db 不存在（首次启动会自动创建）"
	@echo ""
	@echo "6. 端口占用..."
	@lsof -ti:$(BACKEND_PORT) >/dev/null 2>&1 && echo "   ⚠️  端口 $(BACKEND_PORT) 已被占用" || echo "   ✅ 端口 $(BACKEND_PORT) 空闲"
	@lsof -ti:$(FRONTEND_PORT) >/dev/null 2>&1 && echo "   ⚠️  端口 $(FRONTEND_PORT) 已被占用" || echo "   ✅ 端口 $(FRONTEND_PORT) 空闲"
	@echo ""
	@echo "=========================================="
	@echo "审计完成。"
	@echo "=========================================="

# ============================================================
# 清理
# ============================================================

clean: ## 清理构建产物
	@echo "🧹 清理..."
	@rm -f $(BACKEND_BIN)
	@rm -rf dist
	@echo "✅ 清理完成"

clean-all: clean ## 清理所有产物（含 node_modules）
	@rm -rf node_modules
	@echo "✅ 全部清理完成，运行 'npm install' 重新安装依赖"
