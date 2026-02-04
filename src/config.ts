import dotenv from 'dotenv';

dotenv.config();

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

const upstreamHost = stripTrailingSlash(
  process.env.UPSTREAM_URL || 'https://ai-gateway.vercel.sh',
);

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  authKey: process.env.AUTH_KEY || '',

  // NOTE:
  // - upstreamUrl: 仅 host（例如 https://ai-gateway.vercel.sh）
  // - upstreamOpenAIBaseUrl: OpenAI-compatible base（默认 /v1）
  // - upstreamAiSdkBaseUrl: AI SDK Gateway base（默认 /v3/ai）
  upstreamUrl: upstreamHost,
  upstreamOpenAIBaseUrl: stripTrailingSlash(
    process.env.UPSTREAM_OPENAI_BASE_URL || `${upstreamHost}/v1`,
  ),
  upstreamAiSdkBaseUrl: stripTrailingSlash(
    process.env.UPSTREAM_AI_SDK_BASE_URL || `${upstreamHost}/v3/ai`,
  ),

  keysFile: process.env.KEYS_FILE || './data/keys/keys.txt',

  // 兼容：旧变量 COOLDOWN_HOURS
  cooldownHours: parseInt(
    process.env.KEY_COOLDOWN_HOURS || process.env.COOLDOWN_HOURS || '24',
    10,
  ),

  logLevel: process.env.LOG_LEVEL || 'info',
  logDir: process.env.LOG_DIR || './logs',

  // 定时任务配置
  enableScheduler: process.env.ENABLE_SCHEDULER !== 'false', // 默认启用
  dailyTaskTime: process.env.DAILY_TASK_TIME || '00:00', // 每日任务执行时间 (HH:mm)
};
