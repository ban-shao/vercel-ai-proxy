#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# 重新编译
echo "重新编译 TypeScript..."
npm run build

if command -v pm2 &> /dev/null; then
    pm2 restart vercel-ai-proxy
    pm2 logs vercel-ai-proxy --lines 20
else
    echo "PM2 未安装，请手动重启"
    $SCRIPT_DIR/stop.sh
    $SCRIPT_DIR/start.sh
fi
