import { Model, Provider } from './types';

/**
 * 从模型 ID 检测 Provider
 */
export function detectProvider(modelId: string): Provider {
  const id = modelId.toLowerCase();
  
  // Anthropic / Claude
  if (id.includes('claude') || id.startsWith('anthropic/')) {
    return 'anthropic';
  }
  
  // Google / Gemini
  if (id.includes('gemini') || id.startsWith('google/')) {
    return 'google';
  }
  
  // XAI / Grok
  if (id.includes('grok') || id.startsWith('xai/')) {
    return 'xai';
  }
  
  // DeepSeek
  if (id.includes('deepseek') || id.startsWith('deepseek/')) {
    return 'deepseek';
  }
  
  // 默认 OpenAI
  return 'openai';
}

/**
 * 标准化模型 ID
 * 将简写转换为完整格式
 */
export function normalizeModelId(modelId: string): string {
  // 已经是完整格式
  if (modelId.includes('/')) {
    return modelId;
  }
  
  const provider = detectProvider(modelId);
  return `${provider}/${modelId}`;
}

/**
 * 获取支持的模型列表
 */
export function getSupportedModels(): Model[] {
  return [
    // Anthropic
    { id: 'anthropic/claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic' },
    { id: 'anthropic/claude-opus-4-20250514', name: 'Claude Opus 4', provider: 'anthropic' },
    { id: 'anthropic/claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
    { id: 'anthropic/claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic' },
    
    // OpenAI
    { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' },
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
    { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai' },
    { id: 'openai/o1', name: 'o1', provider: 'openai' },
    { id: 'openai/o1-mini', name: 'o1 Mini', provider: 'openai' },
    { id: 'openai/o1-pro', name: 'o1 Pro', provider: 'openai' },
    { id: 'openai/o3', name: 'o3', provider: 'openai' },
    { id: 'openai/o3-mini', name: 'o3 Mini', provider: 'openai' },
    
    // Google
    { id: 'google/gemini-2.5-pro-preview-06-05', name: 'Gemini 2.5 Pro', provider: 'google' },
    { id: 'google/gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash', provider: 'google' },
    { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google' },
    
    // XAI
    { id: 'xai/grok-3', name: 'Grok 3', provider: 'xai' },
    { id: 'xai/grok-3-fast', name: 'Grok 3 Fast', provider: 'xai' },
    { id: 'xai/grok-2', name: 'Grok 2', provider: 'xai' },
  ];
}

/**
 * 思考强度转换为 token 预算
 */
export function effortToTokenBudget(effort: string, maxTokens: number = 16000): number {
  const ratios: Record<string, number> = {
    'low': 0.25,
    'medium': 0.5,
    'high': 0.75
  };
  
  const ratio = ratios[effort] || 0.5;
  const minBudget = 1024;
  const maxBudget = Math.min(maxTokens * ratio, 32000);
  
  return Math.floor(Math.max(minBudget, maxBudget));
}

/**
 * 判断是否为推理模型
 */
export function isReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    // OpenAI reasoning models
    id.includes('o1') ||
    id.includes('o3') ||
    // Claude with thinking
    (id.includes('claude') && (id.includes('opus') || id.includes('sonnet'))) ||
    // Gemini thinking
    id.includes('gemini-2.5')
  );
}
