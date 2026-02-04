# Vercel AI Proxy

🚀 **Vercel AI Gateway 代理服务** - 对外提供 **OpenAI 兼容** 的 `/v1/*` 端点（方便 NewAPI / Cherry Studio / OpenAI SDK 等直接接入），对内使用 **官方 AI SDK Gateway（`createGateway`）** 调用 Vercel AI Gateway，并把 `reasoning_effort` 等参数转换为各 Provider 的特定格式。

## ✨ 特性

- 🔄 **官方 AI SDK Gateway** - 使用 Vercel 官方 AI SDK 的 Gateway Provider（`createGateway`），避免手写“上游协议”导致兼容性问题
- 🔌 **OpenAI 兼容输入** - 客户端使用标准 OpenAI API 格式，无需关心底层 Provider 差异
- 🧠 **智能参数转换** - 自动将 `reasoning_effort` 等参数转换为各 Provider 特定格式（Anthropic/OpenAI/Google/XAI）
- 🔑 **密钥池管理** - 支持多密钥轮换、故障转移、自动冷却
- 🌊 **流式响应** - 完整支持 SSE 流式输出
- 📊 **模型列表** - 优先从上游获取模型列表；失败时回退到内置列表
- 💰 **余额检查** - 批量检查密钥余额，自动筛选有效密钥
- ⏰ **定时刷新** - 每日自动刷新额度、检查余额、更新密钥列表
- 📁 **密钥分类** - 按余额自动分类保存（高余额优先使用）

## ⚠️ 关于“为什么还是 /v1/chat/completions，而不是 /v1/ai/language-model？”

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

# 定时任务配置
ENABLE_SCHEDULER=true        # 是否启用定时任务
DAILY_TASK_TIME=00:00        # 每日任务执行时间 (HH:mm)
```

### 添加 API 密钥

在 `data/keys/keys.txt` 中添加 Vercel AI Gateway 的 API 密钥，每行一个：

```
vag_xxxxxxxxxxxx
vag_yyyyyyyyyyyy
vag_zzzzzzzzzzzz
```

如果需要使用完整的密钥管理功能，建议将所有密钥放在 `data/keys/total_keys.txt` 中，系统会自动生成分类文件。

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

### 管理端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/admin/status` | GET | 获取详细密钥状态 |
| `/admin/reload` | POST | 重新加载密钥文件 |
| `/admin/reset` | POST | 重置所有密钥状态 |
| `/admin/check` | POST | 执行余额检查 |
| `/admin/refresh` | POST | 执行密钥刷新 |
| `/admin/daily-task` | POST | 手动触发每日任务 |

## 📁 密钥文件结构

```
data/keys/
├── total_keys.txt      # 原始密钥（手动维护）
├── active_keys.txt     # 有效密钥（自动生成，余额>0）
├── keys_high.txt       # $3+ 高余额（优先使用）
├── keys_medium_high.txt # $2-3 中高余额
├── keys_medium.txt     # $1-2 中余额
├── keys_low.txt        # $0-1 低余额
└── keys_zero.txt       # $0 无余额
```

## ⏰ 每日定时任务流程

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
       │ • keys_high.txt   │  $3+ 高余额
       │ • keys_medium.txt │  $1-3 中余额
       └────────┬─────────┘
               ↓
       ┌────────▼─────────┐
       │ 4. 热加载密钥列表 │  自动使用高余额密钥
       └──────────────────┘
```

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

## 📄 License

MIT
