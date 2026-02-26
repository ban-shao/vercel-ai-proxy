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

/**
 * 检查消息内容是否为空
 */
function isContentEmpty(content: any): boolean {
  if (content === null || content === undefined) return true;
  if (typeof content === 'string') return content.trim() === '';
  if (Array.isArray(content)) {
    if (content.length === 0) return true;
    // 检查数组中是否所有元素的文本内容都为空
    return content.every((part) => {
      if (part.type === 'text') return !part.text || part.text.trim() === '';
      // image_url 等非文本类型视为非空
      return false;
    });
  }
  return false;
}

/**
 * 预处理消息数组，确保不会有空内容的消息发送到上游 API
 * - Anthropic/Claude 不接受 content 为空的消息
 * - 对空内容使用占位符 "." 保持对话结构完整
 */
function sanitizeMessages(messages: Message[]): Message[] {
  return messages.map((msg) => {
    if (isContentEmpty(msg.content)) {
      logger.debug(`消息 role=${msg.role} 内容为空，使用占位符替代`);
      return { ...msg, content: '.' };
    }
    return msg;
  });
}

// 转换消息格式
function convertMessages(messages: Message[]): CoreMessage[] {
  // 先清理空内容消息
  const sanitized = sanitizeMessages(messages);

  return sanitized.map((msg) => {
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

/**
 * 从流式事件中提取文本增量
 * 兼容不同版本 AI SDK 的字段名差异：textDelta / delta / text
 */
function extractDelta(part: any): string {
  return part.textDelta ?? part.delta ?? part.text ?? '';
}

/**
 * 从 usage 对象中提取 token 使用信息
 * 兼容不同版本 AI SDK 的字段名差异
 */
function extractUsage(rawUsage: any): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} | undefined {
  if (!rawUsage) return undefined;

  const promptTokens = extractTokenCount(
    rawUsage.promptTokens ?? rawUsage.inputTokens,
  );
  const completionTokens = extractTokenCount(
    rawUsage.completionTokens ?? rawUsage.outputTokens,
  );
  const totalTokens =
    extractTokenCount(rawUsage.totalTokens) || promptTokens + completionTokens;

  return { promptTokens, completionTokens, totalTokens };
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

  // 转换消息（内部会自动清理空内容）
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

  // Anthropic 模型开启 thinking 时，必须设置 maxTokens
  // 否则 Claude API 可能返回空内容或截断响应
  if (
    providerType === 'anthropic' &&
    providerOptions?.anthropic?.thinking &&
    !params.maxTokens
  ) {
    params.maxTokens = 16384;
    logger.debug('Anthropic thinking 已启用但未设置 maxTokens，使用默认值 16384');
  }

  // 透传其余字段（排除已经处理的字段和思考相关字段）
  const excludedKeys = new Set([
    'model',
    'messages',
    'stream',
    'max_tokens',
    'temperature',
    'top_p',
    'reasoning_effort',
    'thinking',
    'enable_thinking',
    'thinking_budget',
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
    const result = streamText(params);

    // 创建一个生成器来处理流式响应
    async function* processStream(): AsyncIterable<StreamChunk> {
      let reasoningContent = '';
      let textContent = '';
      let doneEmitted = false;

      try {
        // 使用 fullStream 来获取完整的流式数据（包括思考内容）
        for await (const part of result.fullStream) {
          const type = part.type;

          // 处理推理/思考事件
          if (type === 'reasoning-delta') {
            const delta = extractDelta(part);
            if (!delta) continue;

            reasoningContent += delta;
            yield { type: 'reasoning', content: delta };
          }
          // 处理正常文本事件
          else if (type === 'text-delta') {
            const delta = extractDelta(part);
            if (!delta) continue;

            textContent += delta;
            yield { type: 'text', content: delta };
          }
          // 处理流结束事件
          // AI SDK v5+: 'finish' (totalUsage) 和 'finish-step' (usage)
          else if (type === 'finish' || type === 'finish-step') {
            // 避免重复发送 done 事件
            if (doneEmitted) continue;

            // v5+ 的 finish 事件使用 totalUsage，finish-step 使用 usage
            const rawUsage = (part as any).usage || (part as any).totalUsage;
            const usage = extractUsage(rawUsage);

            if (usage) {
              yield { type: 'done', usage };
              doneEmitted = true;
            }
            // 如果是 finish 事件（最终事件），即使没有 usage 也要发 done
            if (type === 'finish' && !doneEmitted) {
              yield { type: 'done' };
              doneEmitted = true;
            }
          }
        }
      } catch (error) {
        // 流处理中的错误会在 routes.ts 的 catch 中处理
        throw error;
      } finally {
        // 确保 done 事件始终被发送，即使流异常结束或没有 finish 事件
        if (!doneEmitted) {
          logger.warn('流结束但未收到 finish 事件，强制发送 done');
          yield { type: 'done' };
        }
      }

      // 记录流式响应统计
      if (!textContent && reasoningContent) {
        logger.info(`流式响应: 模型仅返回推理内容 (${reasoningContent.length} 字符)，无正文文本`);
      } else if (!textContent && !reasoningContent) {
        logger.warn(`流式响应: 模型未返回任何文本和推理内容，模型: ${modelId}`);
      }
    }

    return { stream: processStream() };
  }

  // 非流式响应
  const result = await generateText(params);

  // 提取文本 - 兼容不同版本 AI SDK
  let text = result.text || '';

  // 如果 text 为空，尝试从 result.content 数组提取（AI SDK v5+）
  if (!text) {
    const content = (result as any).content;
    if (Array.isArray(content)) {
      text = content
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text || '')
        .join('');

      if (text) {
        logger.debug('从 result.content 数组中提取到文本内容');
      }
    }
  }

  // 提取推理内容 - 优先使用 reasoningText（字符串），其次是 reasoning
  let reasoning: string | undefined;

  // AI SDK v5+: reasoningText 是字符串格式
  const reasoningText = (result as any).reasoningText;
  if (typeof reasoningText === 'string' && reasoningText) {
    reasoning = reasoningText;
  } else {
    // 尝试从 reasoning 字段获取（可能是字符串或 ReasoningDetail 数组）
    const rawReasoning = (result as any).reasoning;
    if (typeof rawReasoning === 'string') {
      reasoning = rawReasoning;
    } else if (Array.isArray(rawReasoning)) {
      reasoning = rawReasoning
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text || '')
        .join('\n');
      if (!reasoning) {
        // 可能是简单字符串数组
        reasoning = rawReasoning
          .filter((p: any) => typeof p === 'string')
          .join('\n');
      }
    }
  }

  // 转换 usage 格式
  const usage = extractUsage(result.usage);

  // 调试日志: 空响应
  if (!text && usage && usage.completionTokens > 0) {
    logger.warn(
      `非流式响应文本为空，但消耗了 ${usage.completionTokens} 个 completion tokens，模型: ${modelId}`,
    );
    if (reasoning) {
      logger.info('模型仅返回了推理内容，无正文文本');
    }
    // 打印 result 的可用字段帮助调试
    const resultKeys = Object.keys(result).filter(
      (k) => (result as any)[k] !== undefined && (result as any)[k] !== null,
    );
    logger.debug(`generateText result 可用字段: ${resultKeys.join(', ')}`);
  }

  return {
    text,
    reasoning,
    usage,
  };
}

export { ProviderType };
