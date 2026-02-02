import express, { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { logger } from './logger';
import { keyManager } from './key-manager';
import { chatCompletion, detectProvider } from './ai-provider';
import { ChatCompletionRequest } from './types';

export function createServer() {
  const app = express();
  
  app.use(express.json({ limit: '50mb' }));
  
  // CORS
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });
  
  // 认证中间件
  const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    if (!config.authKey) {
      return next();
    }
    
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: { message: 'Unauthorized: Missing Authorization header', type: 'auth_error' } });
    }
    
    const token = authHeader.replace('Bearer ', '');
    if (token !== config.authKey) {
      return res.status(401).json({ error: { message: 'Unauthorized: Invalid API key', type: 'auth_error' } });
    }
    
    next();
  };
  
  // 健康检查
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0.0' });
  });
  
  // 密钥状态
  app.get('/status', authMiddleware, (req, res) => {
    res.json(keyManager.getStats());
  });
  
  // 模型列表
  app.get('/v1/models', authMiddleware, async (req, res) => {
    try {
      const apiKey = keyManager.getNextKey();
      if (!apiKey) {
        return res.status(503).json({ error: { message: 'No available API keys', type: 'service_error' } });
      }
      
      // 从上游获取模型列表
      const response = await fetch(`${config.upstreamUrl}/v1/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      
      if (!response.ok) {
        throw new Error(`Upstream error: ${response.status}`);
      }
      
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      logger.error('获取模型列表失败:', error.message);
      res.status(500).json({ error: { message: 'Failed to fetch models', type: 'api_error' } });
    }
  });
  
  // 聊天完成 (核心端点)
  app.post('/v1/chat/completions', authMiddleware, async (req, res) => {
    const request: ChatCompletionRequest = req.body;
    
    if (!request.model) {
      return res.status(400).json({ error: { message: 'Missing required field: model', type: 'invalid_request_error' } });
    }
    
    if (!request.messages || !Array.isArray(request.messages)) {
      return res.status(400).json({ error: { message: 'Missing required field: messages', type: 'invalid_request_error' } });
    }
    
    // 获取 API Key
    const apiKey = keyManager.getNextKey();
    if (!apiKey) {
      return res.status(503).json({ error: { message: 'No available API keys', type: 'service_error' } });
    }
    
    try {
      const result = await chatCompletion(request, apiKey);
      
      if (request.stream && result.stream) {
        // 流式响应
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        
        const requestId = `chatcmpl-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        
        try {
          for await (const chunk of result.stream) {
            const data = {
              id: requestId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: request.model,
              choices: [{
                index: 0,
                delta: { content: chunk },
                finish_reason: null,
              }],
            };
            res.write(`data: ${JSON.stringify(data)}\n\n`);
          }
          
          // 发送结束标记
          const finalData = {
            id: requestId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: request.model,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: 'stop',
            }],
          };
          res.write(`data: ${JSON.stringify(finalData)}\n\n`);
          res.write('data: [DONE]\n\n');
          
          // 标记成功
          keyManager.markKeySuccess(apiKey);
        } catch (streamError: any) {
          logger.error('流式响应错误:', streamError.message);
          // 尝试发送错误
          const errorData = {
            id: requestId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: request.model,
            choices: [{
              index: 0,
              delta: { content: `\n\n[Error: ${streamError.message}]` },
              finish_reason: 'error',
            }],
          };
          res.write(`data: ${JSON.stringify(errorData)}\n\n`);
          res.write('data: [DONE]\n\n');
        }
        
        res.end();
      } else {
        // 非流式响应
        const requestId = `chatcmpl-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        
        const response = {
          id: requestId,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: request.model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: result.text || '',
              ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
            },
            finish_reason: 'stop',
          }],
          usage: result.usage ? {
            prompt_tokens: result.usage.promptTokens,
            completion_tokens: result.usage.completionTokens,
            total_tokens: result.usage.totalTokens,
          } : undefined,
        };
        
        // 标记成功
        keyManager.markKeySuccess(apiKey);
        
        res.json(response);
      }
    } catch (error: any) {
      logger.error('聊天请求失败:', error.message);
      
      // 根据错误类型判断是否需要冷却密钥
      const errorMessage = error.message?.toLowerCase() || '';
      if (errorMessage.includes('rate') || 
          errorMessage.includes('limit') || 
          errorMessage.includes('quota') ||
          errorMessage.includes('429')) {
        keyManager.markKeyFailed(apiKey);
      }
      
      res.status(500).json({
        error: {
          message: error.message || 'Internal server error',
          type: 'api_error',
        }
      });
    }
  });
  
  // Completions 端点 (兼容旧版本)
  app.post('/v1/completions', authMiddleware, async (req, res) => {
    // 转换为 chat completions 格式
    const chatRequest: ChatCompletionRequest = {
      model: req.body.model,
      messages: [{ role: 'user', content: req.body.prompt }],
      stream: req.body.stream,
      temperature: req.body.temperature,
      max_tokens: req.body.max_tokens,
      top_p: req.body.top_p,
    };
    
    // 重用 chat completions 逻辑
    req.body = chatRequest;
    return app._router.handle(req, res, () => {});
  });
  
  // 其他 OpenAI 兼容端点 (透传)
  app.all('/v1/*', authMiddleware, async (req, res) => {
    const apiKey = keyManager.getNextKey();
    if (!apiKey) {
      return res.status(503).json({ error: { message: 'No available API keys', type: 'service_error' } });
    }
    
    try {
      const response = await fetch(`${config.upstreamUrl}${req.path}`, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
      });
      
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error: any) {
      logger.error('代理请求失败:', error.message);
      res.status(500).json({ error: { message: error.message, type: 'api_error' } });
    }
  });
  
  return app;
}
