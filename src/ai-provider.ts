import { streamText, generateText, CoreMessage } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import { config } from './config';
import { logger } from './logger';
import { ChatCompletionRequest, ProviderType, Message } from './types';

// 模型到 Provider 的映射
const MODEL_PROVIDER_MAP: Record<string, ProviderType> = {
  // Anthropic
  'claude': 'anthropic',
  'claude-3': 'anthropic',
  'claude-4': 'anthropic',
  'claude-sonnet': 'anthropic',
  'claude-opus': 'anthropic',
  'claude-haiku': 'anthropic',
  
  // OpenAI
  'gpt': 'openai',
  'gpt-4': 'openai',
  'gpt-3.5': 'openai',
  'o1': 'openai',
  'o3': 'openai',
  'chatgpt': 'openai',
  
  // Google
  'gemini': 'google',
  'gemini-pro': 'google',
  'gemini-2': 'google',
  
  // XAI
  'grok': 'xai',
};

// 检测模型的 Provider 类型
export function detectProvider(model: string): ProviderType {
  const modelLower = model.toLowerCase();
  
  // 检查是否有 provider 前缀 (如 anthropic/claude-sonnet-4)
  if (modelLower.includes('/')) {
    const prefix = modelLower.split('/')[0];
    if (['anthropic', 'openai', 'google', 'xai'].includes(prefix)) {
      return prefix as ProviderType;
    }
  }
  
  // 按模型名称匹配
  for (const [pattern, provider] of Object.entries(MODEL_PROVIDER_MAP)) {
    if (modelLower.includes(pattern)) {
      return provider;
    }
  }
  
  return 'openai'; // 默认使用 OpenAI 兼容模式
}

// 标准化模型 ID
function normalizeModelId(model: string): string {
  // 移除 provider 前缀
  if (model.includes('/')) {
    return model.split('/').slice(1).join('/');
  }
  return model;
}

// 计算思考 token 预算
function calculateThinkingBudget(effort: string, maxTokens?: number): number {
  const budgetMap: Record<string, number> = {
    'low': 4000,
    'medium': 8000,
    'high': 16000,
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
  return messages.map(msg => {
    if (typeof msg.content === 'string') {
      return {
        role: msg.role,
        content: msg.content,
      };
    }
    
    // 处理多模态内容
    const parts = msg.content.map(part => {
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
      budgetTokens: calculateThinkingBudget(request.reasoning_effort, request.max_tokens),
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
function buildOpenAIOptions(request: ChatCompletionRequest, modelId: string) {
  const options: Record<string, any> = {};
  const modelLower = modelId.toLowerCase();
  
  // 只有 o1/o3/gpt-5 等推理模型才支持 reasoningEffort
  const isReasoningModel = modelLower.startsWith('o1') || 
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
      thinkingBudget: calculateThinkingBudget(request.reasoning_effort, request.max_tokens),
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

// 创建 AI Provider 实例
function createProvider(providerType: ProviderType, apiKey: string) {
  const baseURL = `${config.upstreamUrl}/v1/ai`;
  
  switch (providerType) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL: `${baseURL}#anthropic` });
    case 'openai':
      return createOpenAI({ apiKey, baseURL: `${baseURL}#openai` });
    case 'google':
      return createGoogleGenerativeAI({ apiKey, baseURL: `${baseURL}#google` });
    case 'xai':
      return createXai({ apiKey, baseURL: `${baseURL}#xai` });
    default:
      return createOpenAI({ apiKey, baseURL });
  }
}

// 主要的聊天完成函数
export async function chatCompletion(
  request: ChatCompletionRequest,
  apiKey: string
): Promise<{
  stream?: AsyncIterable<any>;
  text?: string;
  reasoning?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}> {
  const providerType = detectProvider(request.model);
  const modelId = normalizeModelId(request.model);
  const provider = createProvider(providerType, apiKey);
  
  logger.info(`请求: model=${request.model}, provider=${providerType}, normalized=${modelId}, stream=${request.stream}`);
  
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
    model: provider(modelId),
    messages,
    maxTokens: request.max_tokens,
    temperature: request.temperature,
    topP: request.top_p,
  };
  
  if (providerOptions) {
    params.providerOptions = providerOptions;
  }
  
  // 流式或非流式
  if (request.stream) {
    const result = await streamText(params);
    return { stream: result.textStream };
  } else {
    const result = await generateText(params);
    return {
      text: result.text,
      reasoning: (result as any).reasoning,
      usage: result.usage,
    };
  }
}

export { ProviderType };
