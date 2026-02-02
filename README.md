# Vercel AI Proxy

🚀 **Vercel AI Gateway 代理服务** - 对外提供 **OpenAI 兼容** 的 `/v1/*` 端点（方便 NewAPI / Cherry Studio / OpenAI SDK 等直接接入），对内使用 **官方 AI SDK Gateway（`createGateway`）** 调用 Vercel AI Gateway，并把 `reasoning_effort` 等参数转换为各 Provider 的特定格式。

## ✨ 特性

- 🔄 **官方 AI SDK Gateway** - 使用 Vercel 官方 AI SDK 的 Gateway Provider（`createGateway`），避免手写“上游协议”导致兼容性问题
- 🔌 **OpenAI 兼容输入** - 客户端使用标准 OpenAI API 格式，无需关心底层 Provider 差异
- 🧠 **智能参数转换** - 自动将 `reasoning_effort` 等参数转换为各 Provider 特定格式（Anthropic/OpenAI/Google/XAI）
- 🔑 **密钥池管理** - 支持多密钥轮换、故障转移、自动冷却
- 🌊 **流式响应** - 完整支持 SSE 流式输出
- 📊 **模型列表** - 优先从上游获取模型列表；失败时回退到内置列表

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
```

### 添加 API 密钥

在 `data/keys/keys.txt` 中添加 Vercel AI Gateway 的 API 密钥，每行一个：

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
