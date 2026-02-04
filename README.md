# Vercel AI Proxy

🚀 **Vercel AI Gateway 代理服务** - 对外提供 **OpenAI 兼容** 的 `/v1/*` 端点（方便 NewAPI / Cherry Studio / OpenAI SDK 等直接接入），对内使用 **官方 AI SDK Gateway（`createGateway`）** 调用 Vercel AI Gateway，并把 `reasoning_effort` 等参数转换为各 Provider 的特定格式。

## ✨ 特性

- 🔄 **官方 AI SDK Gateway** - 使用 Vercel 官方 AI SDK 的 Gateway Provider（`createGateway`），避免手写"上游协议"导致兼容性问题
- 🔌 **OpenAI 兼容输入** - 客户端使用标准 OpenAI API 格式，无需关心底层 Provider 差异
- 🧠 **智能参数转换** - 自动将 `reasoning_effort` 等参数转换为各 Provider 特定格式（Anthropic/OpenAI/Google/XAI）
- 🔑 **密钥池管理** - 支持多密钥轮换、故障转移、自动冷却
- 🌊 **流式响应** - 完整支持 SSE 流式输出
- 📊 **模型列表** - 优先从上游获取模型列表；失败时回退到内置列表
- 💰 **完整密钥管理** - 余额检查、定时刷新、按余额分类（NEW!）
- ⏰ **每日自动刷新** - 定时执行密钥刷新和余额检查（NEW!）

## ⚠️ 关于"为什么还是 /v1/chat/completions，而不是 /v1/ai/language-model？"

- **对外（你的客户端）**：本项目要兼容 OpenAI 客户端生态，所以暴露的是 **OpenAI-compatible API**：
  - `POST /v1/chat/completions`
  - `GET /v1/models`
  - 等

- **对内（本项目调用 Vercel AI Gateway）**：AI SDK Gateway 使用的是 Vercel 的 **AI SDK 专用 API**，默认 baseURL 是：
  - `https://ai-gateway.vercel.sh/v3/ai`

  它内部会请求类似 `.../language-model` 的接口（这是 AI SDK 的内部协议），但这与对外暴露的 OpenAI 兼容端点不冲突。

> 参考：Vercel 文档中，OpenAI-compatible base URL 是 `https://ai-gateway.vercel.sh/v1`，AI SDK Gateway 默认 baseURL 是 `https://ai-gateway.vercel.sh/v3/ai`。

## 📦 安装

### 方式一：快速安装

```bash
# 克隆仓库
git clone https://github.com/ban-shao/vercel-ai-proxy.git
cd vercel-ai-proxy

# 运行安装脚本
chmod +x scripts/install.sh
./scripts/install.sh
```

### 方式二：手动安装

```bash
npm install
npm run build
cp .env.example .env
# 编辑 .env
npm start
```

### 方式三：Docker

```bash
docker build -t vercel-ai-proxy .

docker run -d \
  -p 3001:3001 \
  -v $(pwd)/.env:/app/.env \
  -v $(pwd)/data/keys:/app/data/keys \
  vercel-ai-proxy
```

### 方式四：Docker Compose

```bash
docker-compose up -d
```

## ⚙️ 配置

创建 `.env` 文件：

```bash
# 服务端口
PORT=3001

# 认证密钥（访问此代理服务需要的密钥）
AUTH_KEY=your-auth-key-here

# 上游 Vercel AI Gateway Host（建议仅写 host，不带 /v1 /v3 等路径）
UPSTREAM_URL=https://ai-gateway.vercel.sh

# 密钥文件路径（存放 Vercel AI Gateway API Keys）
KEYS_FILE=data/keys/keys.txt

# 密钥冷却时间（小时）
KEY_COOLDOWN_HOURS=24

# 日志级别 (debug/info/warn/error)
LOG_LEVEL=info

# ========== 定时任务配置 ==========

# 是否启用定时任务调度器（true/false）
SCHEDULER_ENABLED=false

# 每日任务执行时间（格式: HH:MM，默认 00:00）
DAILY_TASK_TIME=00:00
```

### 添加 API 密钥

在 `data/keys/total_keys.txt`（或 `keys.txt`）中添加 Vercel AI Gateway 的 API 密钥，每行一个：

```
vag_xxxxxxxxxxxx
vag_yyyyyyyyyyyy
vag_zzzzzzzzzzzz
```

## 🚀 使用方法

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/chat/completions` | POST | 聊天完成（主要端点） |
| `/v1/completions` | POST | 旧版 completions 兼容 |
| `/v1/models` | GET | 获取模型列表 |
| `/v1/models/:id` | GET | 获取单个模型信息 |
| `/health` | GET | 健康检查 |
| `/status` | GET | 密钥池状态 |
| `/stats` | GET | 统计信息 |
| `/admin/reload` | POST | 重新加载密钥（需认证） |
| `/admin/status` | GET | 详细密钥状态（需认证） |
| `/admin/reset` | POST | 重置所有密钥状态（需认证） |

## 📝 请求格式

### 基础请求

```json
{
  "model": "claude-sonnet-4",
  "messages": [
    {"role": "user", "content": "你好"}
  ],
  "stream": true
}
```

### 带思考参数（推荐方式）

```json
{
  "model": "claude-sonnet-4",
  "messages": [
    {"role": "user", "content": "解释量子计算的原理"}
  ],
  "reasoning_effort": "high",
  "stream": true
}
```

## 🔄 参数转换对照表

| 输入参数 | → Anthropic | → OpenAI (o1/o3) | → Google | → XAI |
|----------|-------------|------------------|----------|-------|
| `reasoning_effort: "low"` | `thinking.budgetTokens=4000` | `reasoningEffort="low"` | `thinkingConfig.thinkingBudget=4000` | `reasoningEffort="low"` |
| `reasoning_effort: "medium"` | `thinking.budgetTokens=8000` | `reasoningEffort="medium"` | `thinkingConfig.thinkingBudget=8000` | `reasoningEffort="high"` |
| `reasoning_effort: "high"` | `thinking.budgetTokens=16000` | `reasoningEffort="high"` | `thinkingConfig.thinkingBudget=16000` | `reasoningEffort="high"` |

---

## 💰 完整密钥管理

本项目现在支持完整的密钥管理功能，包括余额检查、定时刷新和按余额分类。

### 密钥文件说明

```
data/keys/
├── total_keys.txt      # 所有密钥（手动维护）
├── active_keys.txt     # 有效密钥（自动生成，余额>0）
├── keys_high.txt       # $3+ 高余额密钥（自动生成）
├── keys_medium_high.txt # $2-3 中高余额（自动生成）
├── keys_medium.txt     # $1-2 中余额（自动生成）
├── keys_low.txt        # $0-1 低余额（自动生成）
└── keys_zero.txt       # $0 无余额（自动生成）
```

### 手动执行密钥管理

```bash
# 检查所有密钥余额
npm run check
# 或
./scripts/check.sh

# 刷新所有密钥额度（触发 Vercel 的额度刷新机制）
npm run refresh
# 或
./scripts/refresh.sh

# 执行完整每日任务（刷新 + 检查 + 热加载）
npm run daily-task
# 或
./scripts/daily-task.sh
```

### 每日自动刷新

#### 方式一：内置调度器

在 `.env` 中配置：

```bash
# 启用定时任务调度器
SCHEDULER_ENABLED=true

# 每日任务执行时间（默认 00:00）
DAILY_TASK_TIME=00:00
```

然后正常启动服务，调度器会自动在指定时间执行每日任务。

#### 方式二：单独运行调度器

```bash
# 以守护进程模式运行调度器
npm run scheduler
# 或
npx tsx src/scheduler.ts --daemon
```

#### 方式三：使用 crontab

```bash
# 设置 crontab 定时任务（默认每天 00:00 执行）
./scripts/setup-cron.sh

# 或手动添加 crontab
crontab -e
# 添加以下行：
0 0 * * * cd /path/to/vercel-ai-proxy && ./scripts/daily-task.sh >> ./logs/cron.log 2>&1
```

### 每日任务流程

```
00:00  ┌──────────────────┐
       │ 1. 刷新所有密钥   │  触发额度刷新
       └────────┬─────────┘
               ↓ 等待30秒
       ┌────────▼─────────┐
       │ 2. 检查所有余额   │  按余额分类保存
       └────────┬─────────┘
               ↓
       ┌────────▼─────────┐
       │ 3. 生成分类文件   │
       │ • active_keys.txt │  有效密钥
       │ • keys_high.txt   │  $3+ 高余额
       │ • keys_medium.txt │  $1-3 中余额
       └────────┬─────────┘
               ↓
       ┌────────▼─────────┐
       │ 4. 通知代理热加载 │  调用 /admin/reload
       └──────────────────┘
```

### Admin API

所有 Admin API 都需要认证（使用 `.env` 中的 `AUTH_KEY`）：

```bash
# 重新加载密钥文件
curl -X POST http://localhost:3001/admin/reload \
  -H "Authorization: Bearer your-auth-key"

# 查看详细密钥状态
curl http://localhost:3001/admin/status \
  -H "Authorization: Bearer your-auth-key"

# 重置所有密钥状态（清除冷却）
curl -X POST http://localhost:3001/admin/reset \
  -H "Authorization: Bearer your-auth-key"
```

---

## 📊 报告文件

检查和刷新任务会生成报告文件：

```
data/reports/
├── billing_report.json   # 余额检查报告
└── refresh_report.json   # 刷新任务报告
```

### 余额检查报告示例

```json
{
  "timestamp": "2024-01-15T00:00:30.000Z",
  "summary": {
    "total": 10,
    "successful": 9,
    "failed": 1,
    "totalBalance": 27.50,
    "categories": {
      "high": 3,
      "medium_high": 2,
      "medium": 2,
      "low": 2,
      "zero": 0
    }
  },
  "successful": [...],
  "failed": [...]
}
```

## 📄 License

MIT
