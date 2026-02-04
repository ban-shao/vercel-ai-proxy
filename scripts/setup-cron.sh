#!/bin/bash
# 设置 crontab 定时任务

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "⏰ 设置定时任务..."
echo ""

# 默认每天 00:00 执行
CRON_TIME="${1:-0 0 * * *}"

# 生成 cron 任务
CRON_CMD="$CRON_TIME cd $PROJECT_DIR && ./scripts/daily-task.sh >> $PROJECT_DIR/logs/cron.log 2>&1"

echo "将添加以下 cron 任务:"
echo "  $CRON_CMD"
echo ""

read -p "确认添加? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # 获取现有 crontab（如果存在）
    EXISTING_CRON=$(crontab -l 2>/dev/null || true)
    
    # 检查是否已存在相同任务
    if echo "$EXISTING_CRON" | grep -q "vercel-ai-proxy.*daily-task"; then
        echo "⚠️ 已存在相关定时任务，跳过添加"
        echo "   现有任务:"
        echo "$EXISTING_CRON" | grep "vercel-ai-proxy.*daily-task"
    else
        # 添加新任务
        (echo "$EXISTING_CRON"; echo "$CRON_CMD") | crontab -
        echo "✅ 定时任务已添加"
    fi
    
    echo ""
    echo "当前 crontab:"
    crontab -l
else
    echo "已取消"
fi
