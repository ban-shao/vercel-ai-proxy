#!/bin/bash

echo "=== Vercel AI Proxy 状态 ==="
echo ""

if command -v pm2 &> /dev/null; then
    pm2 show vercel-ai-proxy 2>/dev/null || echo "服务未运行"
else
    echo "PM2 未安装"
    ps aux | grep "node dist/index.js" | grep -v grep || echo "服务未运行"
fi

echo ""
echo "=== 端口监听 ==="
netstat -tlnp 2>/dev/null | grep 3001 || ss -tlnp 2>/dev/null | grep 3001 || echo "端口 3001 未监听"
