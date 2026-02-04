import { streamText, generateText, type CoreMessage } from 'ai';
import { createGateway } from '@ai-sdk/gateway';
import { config } from './config';
import { logger } from './logger';
import type { ChatCompletionRequest, ProviderType, Message } from './types';

// 模型到 Provider 的映射（仅用于"简写模型名"的推断）
const MODEL_PROVIDER_MAP: Record<string, ProviderType> = {
  // Anthropic
  claude: 'anthropic',
  'claude-3': 'anthropic',
  'claude-4': 'anthropic',
  'claude-sonnet': 'anthropic',
  'claude-opus': 'anthropic',
  'claude-haiku': 'anthropic',

  // OpenAI
  gpt: 'openai',
  'gpt-4': 'openai',
  'gpt-3.5': 'openai',
  o1: 'openai',
  o3: 'openai',
  chatgpt: 'openai',

  // Google
  gemini: 'google',
  'gemini-pro': 'google',
  'gemini-2': 'google',

  // XAI
  grok: 'xai',
};

/**
 * 检测模型的 Provider 类型
 * - 如果 model 已经带有前缀（anthropic/...），优先使用前缀
 * - 否则按启发式规则推断
 */
export function detectProvider(model: string): ProviderType {
  const modelLower = model.toLowerCase();

  // 检查是否有 provider 前缀 (如 anthropic/claude-sonnet-4)
  if (modelLower.includes('/')) {
    const prefix = modelLower.split('/')[0];
    if (['anthropic', 'openai', 'google', 'xai'].includes(prefix)) {
      return prefix as ProviderType;
    }
    return 'unknown';
  }

  // 按模型名称匹配
  for (const [pattern, provider] of Object.entries(MODEL_PROVIDER_MAP)) {
    if (modelLower.includes(pattern)) {
      return provider;
    }
  }

  return 'openai'; // 默认使用 openai
}

/**
 * 确保模型 ID 符合 AI Gateway（AI SDK）格式：creator/model
 * 例如：claude-sonnet-4 => anthropic/claude-sonnet-4
 */
export function ensureGatewayModelId(model: string): string {
  if (model.includes('/')) {
    return model;
  }
  const provider = detectProvider(model);
  // provider 为 unknown 时，兜底 openai
  return `${provider === 'unknown' ? 'openai' : provider}/${model}`;
}

// 计算思考 token 预算
function calculateThinkingBudget(effort: string, maxTokens?: number): number {
  const budgetMap: Record<string, number> = {
    low: 4000,
    medium: 8000,
    high: 16000,
  };

  const baseBudget = budgetMap[effort] || 8000;

  // 如果有 maxTokens 限制，确保 budget 不超过它
  if (maxTokens && baseBudget > maxTokens * 0.8) {
    return Math.floor(maxTokens * 0.8);
  }

  return baseBudget;
}

// 转换消息格式
function convertMessages(messages: Message[]): CoreMessage[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return {
        role: msg.role,
        content: msg.content,
      };
    }

    // 处理多模态内容
    const parts = msg.content.map((part) => {
      if (part.type === 'text') {
        return { type: 'text' as const, text: part.text || '' };
      } else if (part.type === 'image_url' && part.image_url) {
        return { type: 'image' as const, image: part.image_url.url };
      }
      return { type: 'text' as const, text: '' };
    });

    return {
      role: msg.role,
      content: parts,
    };
  }) as CoreMessage[];
}

// 构建 Anthropic Provider Options
function buildAnthropicOptions(request: ChatCompletionRequest) {
  const options: Record<string, any> = {};

  // 处理思考参数
  if (request.reasoning_effort) {
    options.thinking = {
      type: 'enabled',
      budgetTokens: calculateThinkingBudget(
        request.reasoning_effort,
        request.max_tokens,
      ),
    };
  } else if (request.thinking) {
    options.thinking = {
      type: request.thinking.type || 'enabled',
      budgetTokens: request.thinking.budget_tokens || 8000,
    };
  } else if (request.enable_thinking) {
    options.thinking = {
      type: 'enabled',
      budgetTokens: request.thinking_budget || 8000,
    };
  }

  return Object.keys(options).length > 0 ? { anthropic: options } : undefined;
}

// 构建 OpenAI Provider Options
function buildOpenAIOptions(
  request: ChatCompletionRequest,
  modelId: string,
) {
  const options: Record<string, any> = {};
  const bareModelId = modelId.includes('/')
    ? modelId.split('/').slice(1).join('/')
    : modelId;
  const modelLower = bareModelId.toLowerCase();

  // 只有 o1/o3/gpt-5 等推理模型才支持 reasoningEffort
  const isReasoningModel =
    modelLower.startsWith('o1') ||
    modelLower.startsWith('o3') ||
    modelLower.includes('gpt-5');

  if (isReasoningModel && request.reasoning_effort) {
    options.reasoningEffort = request.reasoning_effort;
  }

  return Object.keys(options).length > 0 ? { openai: options } : undefined;
}

// 构建 Google Provider Options
function buildGoogleOptions(request: ChatCompletionRequest) {
  const options: Record<string, any> = {};

  // 处理思考参数
  if (request.reasoning_effort) {
    options.thinkingConfig = {
      thinkingBudget: calculateThinkingBudget(
        request.reasoning_effort,
        request.max_tokens,
      ),
      includeThoughts: true,
    };
  } else if (request.thinking?.type === 'enabled') {
    options.thinkingConfig = {
      thinkingBudget: request.thinking.budget_tokens || 8000,
      includeThoughts: true,
    };
  } else if (request.enable_thinking) {
    options.thinkingConfig = {
      thinkingBudget: request.thinking_budget || 8000,
      includeThoughts: true,
    };
  }

  return Object.keys(options).length > 0 ? { google: options } : undefined;
}

// 构建 XAI Provider Options
function buildXAIOptions(request: ChatCompletionRequest) {
  const options: Record<string, any> = {};

  // XAI 只支持 low/high
  if (request.reasoning_effort) {
    options.reasoningEffort = request.reasoning_effort === 'low' ? 'low' : 'high';
  }

  return Object.keys(options).length > 0 ? { xai: options } : undefined;
}

// 提取 token 数量（处理嵌套对象或直接数字）
function extractTokenCount(value: any): number {
  if (typeof value === 'number') {
    return value;
  }
  if (value && typeof value === 'object') {
    // Vercel AI SDK 返回格式: { total: number, noCache?: number, ... }
    if (typeof value.total === 'number') {
      return value.total;
    }
    // 尝试其他可能的字段名
    if (typeof value.count === 'number') {
      return value.count;
    }
  }
  return 0;
}

// 流式响应结果类型
export interface StreamResult {
  stream: AsyncIterable<StreamChunk>;
}

export interface StreamChunk {
  type: 'text' | 'reasoning' | 'done';
  content?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// 主要的聊天完成函数
export async function chatCompletion(
  request: ChatCompletionRequest,
  apiKey: string,
): Promise<{
  stream?: AsyncIterable<StreamChunk>;
  text?: string;
  reasoning?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}> {
  const modelId = ensureGatewayModelId(request.model);
  const providerType = detectProvider(modelId);

  const gateway = createGateway({
    apiKey,
    baseURL: config.upstreamAiSdkBaseUrl,
  });

  logger.info(
    `请求: model=${request.model}, normalized=${modelId}, provider=${providerType}, stream=${request.stream}`,
  );

  // 构建 providerOptions
  let providerOptions: Record<string, any> | undefined;
  switch (providerType) {
    case 'anthropic':
      providerOptions = buildAnthropicOptions(request);
      break;
    case 'openai':
      providerOptions = buildOpenAIOptions(request, modelId);
      break;
    case 'google':
      providerOptions = buildGoogleOptions(request);
      break;
    case 'xai':
      providerOptions = buildXAIOptions(request);
      break;
  }

  if (providerOptions) {
    logger.debug('ProviderOptions:', JSON.stringify(providerOptions));
  }

  // 转换消息
  const messages = convertMessages(request.messages);

  // 构建请求参数
  const params: any = {
    model: gateway(modelId),
    messages,
  };

  // 只在为 number 时才传入，避免 null 等非法值触发 SDK 校验错误
  if (typeof request.max_tokens === 'number') {
    params.maxTokens = request.max_tokens;
  }
  if (typeof request.temperature === 'number') {
    params.temperature = request.temperature;
  }
  if (typeof request.top_p === 'number') {
    params.topP = request.top_p;
  }

  // 透传其余字段（排除已经处理的字段）
  const excludedKeys = new Set([
    'model',
    'messages',
    'stream',
    'max_tokens',
    'temperature',
    'top_p',
  ]);

  for (const [key, value] of Object.entries(request)) {
    if (excludedKeys.has(key)) continue;
    if (value === undefined) continue;
    params[key] = value;
  }

  if (providerOptions) {
    params.providerOptions = providerOptions;
  }

  // 流式或非流式
  if (request.stream) {
    const result = await streamText(params);

    // 创建一个生成器来处理流式响应
    async function* processStream(): AsyncIterable<StreamChunk> {
      let reasoningContent = '';
      let textContent = '';

      // 使用 fullStream 来获取完整的流式数据（包括思考内容）
      for await (const part of result.fullStream) {
        if (part.type === 'reasoning') {
          // 思考内容
          const delta =
            (part as any).textDelta ||
            (part as any).text ||
            '';
          if (!delta) continue;

          reasoningContent += delta;
          yield { type: 'reasoning', content: delta };
        } else if (part.type === 'text-delta') {
          // 正常文本内容
          const delta = (part as any).textDelta ?? '';
          if (!delta) continue;

          textContent += delta;
          yield { type: 'text', content: delta };
        } else if (part.type === 'finish') {
          // 流结束，返回 usage
          const rawUsage = (part as any).usage;
          if (rawUsage) {
            const promptTokens = extractTokenCount(
              rawUsage.promptTokens ?? rawUsage.inputTokens,
            );
            const completionTokens = extractTokenCount(
              rawUsage.completionTokens ?? rawUsage.outputTokens,
            );
            yield {
              type: 'done',
              usage: {
                promptTokens,
                completionTokens,
                totalTokens: promptTokens + completionTokens,
              },
            };
          } else {
            yield { type: 'done' };
          }
        }
      }
    }

    return { stream: processStream() };
  }

  const result = await generateText(params);

  // 转换 usage 格式，处理嵌套对象
  let usage:
    | {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      }
    | undefined;

  if (result.usage) {
    const rawUsage = result.usage as any;
    const promptTokens = extractTokenCount(
      rawUsage.promptTokens ?? rawUsage.inputTokens,
    );
    const completionTokens = extractTokenCount(
      rawUsage.completionTokens ?? rawUsage.outputTokens,
    );
    const totalTokens =
      extractTokenCount(rawUsage.totalTokens) ||
      promptTokens + completionTokens;

    usage = {
      promptTokens,
      completionTokens,
      totalTokens,
    };
  }

  return {
    text: result.text,
    reasoning: (result as any).reasoning,
    usage,
  };
}

export { ProviderType };
