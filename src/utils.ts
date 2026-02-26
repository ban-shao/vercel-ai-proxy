import type { Model } from './types';

/**
 * 获取支持的模型列表（本地兜底）
 */
export function getSupportedModels(): Model[] {
  return [
    // Anthropic
    {
      id: 'anthropic/claude-sonnet-4-20250514',
      name: 'Claude Sonnet 4',
      provider: 'anthropic',
    },
    {
      id: 'anthropic/claude-opus-4-20250514',
      name: 'Claude Opus 4',
      provider: 'anthropic',
    },
    {
      id: 'anthropic/claude-3-5-sonnet-20241022',
      name: 'Claude 3.5 Sonnet',
      provider: 'anthropic',
    },
    {
      id: 'anthropic/claude-3-5-haiku-20241022',
      name: 'Claude 3.5 Haiku',
      provider: 'anthropic',
    },

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
    {
      id: 'google/gemini-2.5-pro-preview-06-05',
      name: 'Gemini 2.5 Pro',
      provider: 'google',
    },
    {
      id: 'google/gemini-2.5-flash-preview-05-20',
      name: 'Gemini 2.5 Flash',
      provider: 'google',
    },
    { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google' },

    // XAI
    { id: 'xai/grok-3', name: 'Grok 3', provider: 'xai' },
    { id: 'xai/grok-3-fast', name: 'Grok 3 Fast', provider: 'xai' },
    { id: 'xai/grok-2', name: 'Grok 2', provider: 'xai' },
  ];
}
