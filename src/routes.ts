import { Router, Request, Response } from 'express';
import { AIProvider } from './ai-provider';
import { KeyManager } from './key-manager';
import { config } from './config';
import { logger } from './logger';
import { getSupportedModels, detectProvider, normalizeModelId } from './utils';
import type { ChatCompletionRequest } from './types';

const router = Router();
const keyManager = new KeyManager();
const aiProvider = new AIProvider(config.upstreamUrl, keyManager);

// 模型列表缓存
let modelsCache: any[] | null = null;
let modelsCacheTime = 0;
const CACHE_TTL = 3600 * 1000; // 1小时

/**
 * GET /v1/models - 获取模型列表
 */
router.get('/v1/models', async (req: Request, res: Response) => {
  try {
    const refresh = req.query.refresh === 'true';
    const providerFilter = req.query.provider as string;
    
    // 检查缓存
    if (!refresh && modelsCache && Date.now() - modelsCacheTime < CACHE_TTL) {
      let models = modelsCache;
      if (providerFilter) {
        models = models.filter(m => m.id.startsWith(providerFilter));
      }
      return res.json({ object: 'list', data: models });
    }
    
    // 尝试从上游获取
    const key = keyManager.getKey();
    if (key) {
      try {
        const response = await fetch(`${config.upstreamUrl}/v1/models`, {
          headers: { 'Authorization': `Bearer ${key}` }
        });
        
        if (response.ok) {
          const data = await response.json() as { data: any[] };
          modelsCache = data.data || [];
          modelsCacheTime = Date.now();
          logger.info(`[MODELS] 从上游获取了 ${modelsCache.length} 个模型`);
          
          let models = modelsCache;
          if (providerFilter) {
            models = models.filter(m => m.id.startsWith(providerFilter));
          }
          return res.json({ object: 'list', data: models });
        }
      } catch (error) {
        logger.warn('[MODELS] 从上游获取模型列表失败，使用内置列表');
      }
    }
    
    // 使用内置列表
    let models = getSupportedModels().map(m => ({
      id: m.id,
      object: 'model',
      owned_by: m.provider
    }));
    
    if (providerFilter) {
      models = models.filter(m => m.id.startsWith(providerFilter));
    }
    
    res.json({ object: 'list', data: models });
  } catch (error) {
    logger.error('[MODELS] 获取模型列表失败', error);
    res.status(500).json({ error: 'Failed to get models' });
  }
});

/**
 * GET /v1/models/:modelId - 获取单个模型
 */
router.get('/v1/models/:modelId', (req: Request, res: Response) => {
  const modelId = normalizeModelId(req.params.modelId);
  const models = getSupportedModels();
  const model = models.find(m => m.id === modelId || m.id.endsWith(req.params.modelId));
  
  if (model) {
    res.json({
      id: model.id,
      object: 'model',
      owned_by: model.provider
    });
  } else {
    res.status(404).json({ error: 'Model not found' });
  }
});

/**
 * POST /v1/chat/completions - 聊天补全
 */
router.post('/v1/chat/completions', async (req: Request, res: Response) => {
  try {
    const body = req.body as ChatCompletionRequest;
    const stream = body.stream ?? false;
    
    logger.info(`[CHAT] 模型: ${body.model}, 流式: ${stream}`);
    
    if (stream) {
      // 流式响应
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const result = await aiProvider.streamChat(body);
      
      for await (const chunk of result.textStream) {
        const data = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [{
            index: 0,
            delta: { content: chunk },
            finish_reason: null
          }]
        };
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
      
      // 发送结束标记
      const finalData = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'stop'
        }]
      };
      res.write(`data: ${JSON.stringify(finalData)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // 非流式响应
      const result = await aiProvider.chat(body);
      
      res.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: result.text
          },
          finish_reason: result.finishReason || 'stop'
        }],
        usage: result.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      });
    }
  } catch (error: any) {
    logger.error('[CHAT] 请求失败', error);
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'api_error'
      }
    });
  }
});

/**
 * GET /health - 健康检查
 */
router.get('/health', (req: Request, res: Response) => {
  const stats = keyManager.getStats();
  res.json({
    status: 'ok',
    version: '1.0.0',
    keys: stats
  });
});

/**
 * GET /stats - 统计信息
 */
router.get('/stats', (req: Request, res: Response) => {
  const stats = keyManager.getStats();
  res.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    keys: stats
  });
});

export { router };
