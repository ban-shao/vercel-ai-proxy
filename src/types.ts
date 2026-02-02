// OpenAI 兼容的请求格式
export interface ChatCompletionRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  
  // 扩展参数 - 思考/推理
  reasoning_effort?: 'low' | 'medium' | 'high';
  thinking?: {
    type: 'enabled' | 'disabled' | 'auto';
    budget_tokens?: number;
  };
  enable_thinking?: boolean;
  thinking_budget?: number;
  
  // 其他扩展参数
  [key: string]: any;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

// Provider 类型
export type ProviderType = 'anthropic' | 'openai' | 'google' | 'xai' | 'unknown';

// 密钥状态
export interface KeyStatus {
  key: string;
  usedAt?: Date;
  cooldownUntil?: Date;
  failCount: number;
}

// OpenAI 兼容的响应格式
export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: 'assistant';
      content: string;
      reasoning_content?: string;
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      reasoning_content?: string;
    };
    finish_reason: string | null;
  }[];
}
