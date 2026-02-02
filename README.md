# Vercel AI Proxy

🚀 **Vercel AI Gateway 代理服务** - 使用官方 `@ai-sdk`，支持 OpenAI 兼容格式输入，自动转换参数到各 Provider (Anthropic/OpenAI/Google/XAI)，内置密钥池管理与故障转移。

## ✨ 特性

- 🔄 **官方 AI SDK** - 使用 Vercel 官方 `@ai-sdk/*` 包，确保参数转换 100% 正确
- 🔌 **OpenAI 兼容输入** - 客户端使用标准 OpenAI API 格式，无需关心底层 Provider 差异
- 🧠 **智能参数转换** - 自动将 `reasoning_effort` 等参数转换为各 Provider 特定格式
- 🔑 **密钥池管理** - 支持多密钥轮换、故障转移、自动冷却
- 🌊 **流式响应** - 完整支持 SSE 流式输出
- 📊 **自动模型列表** - 从上游 Vercel AI Gateway 自动获取支持的模型

## 🏗️ 架构

```
用户请求 (OpenAI 兼容格式)
        ↓
    NewAPI / Cherry Studio / 任意客户端
        ↓
┌─────────────────────────────────────┐
│      Vercel AI Proxy (本项目)        │
│  ┌─────────────────────────────────┐ │
│  │  @ai-sdk/anthropic             │ │
│  │  @ai-sdk/openai                │ │
│  │  @ai-sdk/google                │ │
│  │  @ai-sdk/xai                   │ │
│  └─────────────────────────────────┘ │
│  - 参数自动转换                       │
│  - 密钥池管理                         │
│  - 故障转移                           │
└─────────────────────────────────────┘
        ↓
    Vercel AI Gateway
        ↓
Anthropic / OpenAI / Google / XAI
```

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
# 克隆仓库
git clone https://github.com/ban-shao/vercel-ai-proxy.git
cd vercel-ai-proxy

# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 配置环境变量
cp .env.example .env
nano .env

# 启动服务
npm start
```

### 方式三：Docker

```bash
# 构建镜像
docker build -t vercel-ai-proxy .

# 运行容器
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

# 上游 Vercel AI Gateway 地址
UPSTREAM_URL=https://ai-gateway.vercel.sh

# 密钥文件路径（存放 Vercel API Keys）
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

### 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm start

# 使用 PM2 (推荐)
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/chat/completions` | POST | 聊天完成（主要端点） |
| `/v1/models` | GET | 获取模型列表 |
| `/v1/models/:id` | GET | 获取单个模型信息 |
| `/health` | GET | 健康检查 |
| `/status` | GET | 密钥池状态 |

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

### 其他思考参数格式（也支持）

```json
// 方式 2: thinking 对象（Anthropic 风格）
{
  "thinking": {
    "type": "enabled",
    "budget_tokens": 8192
  }
}

// 方式 3: enable_thinking（通用风格）
{
  "enable_thinking": true,
  "thinking_budget": 8000
}
```

## 🔄 参数转换对照表

| 输入参数 | → Anthropic | → OpenAI (o1/o3) | → Google | → XAI |
|----------|-------------|------------------|----------|-------|
| `reasoning_effort: "low"` | `thinking.budgetTokens=4000` | `reasoningEffort="low"` | `thinkingConfig.thinkingBudget=4000` | `reasoningEffort="low"` |
| `reasoning_effort: "medium"` | `thinking.budgetTokens=8000` | `reasoningEffort="medium"` | `thinkingConfig.thinkingBudget=8000` | `reasoningEffort="high"` |
| `reasoning_effort: "high"` | `thinking.budgetTokens=16000` | `reasoningEffort="high"` | `thinkingConfig.thinkingBudget=16000` | `reasoningEffort="high"` |

## 🔌 NewAPI 配置

在 NewAPI 中添加渠道：

| 配置项 | 值 |
|--------|-----|
| 类型 | OpenAI |
| Base URL | `http://127.0.0.1:3001` |
| API Key | 你的 `AUTH_KEY` |
| 模型 | `claude-sonnet-4,claude-opus-4,gpt-4o,gemini-2.5-pro` |

## 📊 支持的模型

### Anthropic
- `claude-sonnet-4` / `claude-sonnet-4-20250514`
- `claude-opus-4` / `claude-opus-4-20250514`
- `claude-3-5-sonnet` / `claude-3-5-sonnet-20241022`
- `claude-3-5-haiku` / `claude-3-5-haiku-20241022`

### OpenAI
- `gpt-4o` / `gpt-4o-mini`
- `gpt-4-turbo`
- `o1` / `o1-mini` / `o1-pro`
- `o3` / `o3-mini`

### Google
- `gemini-2.5-pro` / `gemini-2.5-pro-preview-06-05`
- `gemini-2.5-flash` / `gemini-2.5-flash-preview-05-20`
- `gemini-2.0-flash`

### XAI
- `grok-3` / `grok-3-fast`
- `grok-2`

## 🛠️ 管理命令

```bash
# 启动
./scripts/start.sh

# 停止
./scripts/stop.sh

# 重启
./scripts/restart.sh

# 查看状态
./scripts/status.sh

# 查看日志
./scripts/logs.sh
```

## 📁 目录结构

```
vercel-ai-proxy/
├── src/
│   ├── index.ts          # 入口文件
│   ├── server.ts         # Express 服务器
│   ├── ai-provider.ts    # AI SDK 封装 + 参数转换
│   ├── key-manager.ts    # 密钥池管理
│   ├── config.ts         # 配置管理
│   ├── logger.ts         # 日志工具
│   ├── middleware.ts     # 中间件
│   ├── routes.ts         # 路由
│   ├── utils.ts          # 工具函数
│   └── types.ts          # 类型定义
├── data/keys/            # 密钥文件
├── logs/                 # 日志目录
├── scripts/              # 管理脚本
├── package.json
├── tsconfig.json
├── ecosystem.config.js   # PM2 配置
├── Dockerfile
└── docker-compose.yml
```

## ❓ FAQ

### Q: 与 Python 版本的区别？

| 特性 | Python 版本 | TypeScript 版本 (本项目) |
|------|------------|-------------------------|
| 参数转换 | 手动实现，可能不完整 | 使用官方 `@ai-sdk`，100% 兼容 |
| 维护性 | 需要手动跟进 SDK 更新 | 与官方 SDK 同步 |
| 部署 | 需要 Python 环境 | Node.js 环境 |

### Q: 为什么需要 reasoning_effort 参数？

不同 AI Provider 的思考/推理参数格式不同：
- Anthropic 用 `thinking.budgetTokens`
- OpenAI 用 `reasoningEffort`
- Google 用 `thinkingConfig.thinkingBudget`

本项目让你只需使用统一的 `reasoning_effort`，自动转换为各 Provider 格式。

### Q: 密钥冷却是什么意思？

当某个密钥遇到速率限制（429 错误）时，会自动进入冷却期，期间不会被使用。冷却时间由 `KEY_COOLDOWN_HOURS` 配置。

## 📄 License

MIT

## 🙏 致谢

- [Vercel AI SDK](https://sdk.vercel.ai/)
- [Cherry Studio](https://github.com/CherryHQ/cherry-studio) - 参数转换逻辑参考
