#!/bin/bash
# Banner-PB 启动脚本
# 用法: ./start.sh [--dev]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Go 环境
export PATH="$HOME/.local/go/bin:$PATH"

# 加载 .env
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# 构建并启动
echo "==> 构建 PocketBase 后端..."
go build -o banner-pb .

echo "==> 启动服务（http://127.0.0.1:8090）..."
if [ "$1" = "--dev" ]; then
  # 开发模式：自动迁移 + 详细日志
  ./banner-pb serve --http=127.0.0.1:8090 --dev
else
  ./banner-pb serve --http=127.0.0.1:8090
fi
