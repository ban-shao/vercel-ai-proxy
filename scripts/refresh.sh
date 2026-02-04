#!/bin/bash
# 刷新所有密钥额度

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "🔄 刷新所有密钥额度..."
echo ""

# 检查是否已编译
if [ -f "dist/key-refresher.js" ]; then
    node dist/key-refresher.js
else
    # 使用 tsx 直接运行
    npx tsx src/key-refresher.ts
fi
