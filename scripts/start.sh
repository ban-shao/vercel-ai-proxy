#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# 检查是否需要编译
if [ ! -d "dist" ]; then
    echo "首次运行，编译 TypeScript..."
    npm run build
fi

# 检查是否安装了 pm2
if command -v pm2 &> /dev/null; then
    echo "使用 PM2 启动..."
    pm2 start ecosystem.config.js
    pm2 save
    pm2 logs vercel-ai-proxy --lines 20
else
    echo "使用 Node 直接启动..."
    echo "提示: 建议安装 PM2 进行生产部署: npm install -g pm2"
    node dist/index.js
fi
