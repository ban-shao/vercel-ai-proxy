#!/bin/bash

if command -v pm2 &> /dev/null; then
    pm2 logs vercel-ai-proxy --lines 100
else
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    tail -f $PROJECT_DIR/logs/*.log 2>/dev/null || echo "未找到日志文件"
fi
