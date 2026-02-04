#!/bin/bash
# 检查所有密钥余额

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "📊 检查所有密钥余额..."
echo ""

# 检查是否已编译
if [ -f "dist/billing-checker.js" ]; then
    node dist/billing-checker.js
else
    # 使用 tsx 直接运行
    npx tsx src/billing-checker.ts
fi
