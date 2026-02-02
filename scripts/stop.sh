#!/bin/bash

if command -v pm2 &> /dev/null; then
    pm2 stop vercel-ai-proxy
    echo "✓ 服务已停止"
else
    echo "PM2 未安装，尝试停止进程..."
    pkill -f "node dist/index.js" || true
    echo "✓ 进程已停止"
fi
