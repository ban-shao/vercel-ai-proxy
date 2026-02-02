# Vercel AI Proxy

🚀 Vercel AI Gateway 代理服务 - 使用官方 @ai-sdk

## 特性

- ✅ 官方 Vercel AI SDK (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/xai`)
- ✅ OpenAI 兼容格式输入
- ✅ 自动参数转换（思考强度、推理参数等）
- ✅ 密钥池管理与轮换
- ✅ 故障转移机制

## 安装

```bash
npm install
```

## 配置

复制环境变量示例文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
PORT=3001
AUTH_KEY=your-secret-key
UPSTREAM_URL=https://ai-gateway.vercel.sh
KEYS_FILE=./data/keys/keys_high.txt
```

## 运行

开发模式：

```bash
npm run dev
```

生产模式：

```bash
npm run build
npm start
```

## API 使用

### 聊天完成

```bash
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer your-auth-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4",
    "messages": [{"role": "user", "content": "Hello!"}],
    "reasoning_effort": "high"
  }'
```

### 参数转换

| 输入参数 | Anthropic | OpenAI | Google |
|---------|-----------|--------|--------|
| `reasoning_effort: "high"` | `thinking.budgetTokens=16000` | `reasoningEffort="high"` | `thinkingConfig.thinkingBudget=16000` |
| `thinking.type: "enabled"` | ✅ 直接使用 | - | ✅ 转换 |
| `enable_thinking: true` | ✅ 转换 | - | ✅ 转换 |

## License

MIT
