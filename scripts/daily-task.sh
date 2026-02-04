#!/bin/bash
# 执行每日任务（刷新 + 检查 + 热加载）

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "🚀 执行每日任务..."
echo ""

# 检查是否已编译
if [ -f "dist/daily-task.js" ]; then
    node dist/daily-task.js
else
    # 使用 tsx 直接运行
    npx tsx src/daily-task.ts
fi
