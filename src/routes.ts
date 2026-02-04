import { Router, type Request, type Response } from 'express';
import { Readable } from 'node:stream';
import { config } from './config';
import { logger } from './logger';
import { keyManager } from './key-manager';
import { chatCompletion, ensureGatewayModelId } from './ai-provider';
import { getSupportedModels } from './utils';
import { billingChecker } from './billing-checker';
import { keyRefresher } from './key-refresher';
import { scheduler } from './scheduler';
import type { ChatCompletionRequest } from './types';
import fs from 'fs';
import path from 'path';

export const router = Router();

// 模型列表缓存
let modelsCache: any[] | null = null;
let modelsCacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1小时

function shouldCooldownKeyByErrorMessage(message?: string): boolean {
  const m = (message || '').toLowerCase();
  return m.includes('rate') || m.includes('limit') || m.includes('quota') || m.includes('429');
}

/**
 * GET /health - 健康检查
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '1.1.0',
    upstream: {
      openai: config.upstreamOpenAIBaseUrl,
      ai_sdk: config.upstreamAiSdkBaseUrl,
    },
    keys: keyManager.getStats(),
    scheduler: config.enableScheduler ? 'enabled' : 'disabled',
  });
});

/**
 * GET /status - 密钥池状态
 */
router.get('/status', (req: Request, res: Response) => {
  res.json(keyManager.getStats());
});

/**
 * GET /stats - 统计信息
 */
router.get('/stats', (req: Request, res: Response) => {
  res.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    keys: keyManager.getStats(),
  });
});

// ==================== 管理端点 ====================

/**
 * GET /admin/status - 获取详细密钥状态
 */
router.get('/admin/status', (req: Request, res: Response) => {
  res.json({
    keys: keyManager.getDetailedStats(),
    scheduler: {
      enabled: config.enableScheduler,
      dailyTaskTime: config.dailyTaskTime,
    },
  });
});

/**
 * POST /admin/reload - 重新加载密钥文件
 */
router.post('/admin/reload', (req: Request, res: Response) => {
  try {
    keyManager.reload();
    const stats = keyManager.getStats();
    res.json({
      success: true,
      message: `已重新加载 ${stats.total} 个密钥`,
      stats,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /admin/reset - 重置所有密钥状态
 */
router.post('/admin/reset', (req: Request, res: Response) => {
  try {
    keyManager.resetAll();
    res.json({
      success: true,
      message: '已重置所有密钥状态',
      stats: keyManager.getStats(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /admin/check - 执行余额检查
 */
router.post('/admin/check', async (req: Request, res: Response) => {
  try {
    // 加载密钥
    const keysDir = path.dirname(config.keysFile);
    const totalKeysFile = path.join(keysDir, 'total_keys.txt');
    let keysFile = config.keysFile;
    
    if (fs.existsSync(totalKeysFile)) {
      keysFile = totalKeysFile;
    }

    if (!fs.existsSync(keysFile)) {
      return res.status(400).json({
        success: false,
        error: '密钥文件不存在',
      });
    }

    const content = fs.readFileSync(keysFile, 'utf-8');
    const apiKeys = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    if (apiKeys.length === 0) {
      return res.status(400).json({
        success: false,
        error: '密钥文件为空',
      });
    }

    // 异步执行检查
    res.json({
      success: true,
      message: `开始检查 ${apiKeys.length} 个密钥，请稍后查看日志`,
      keysCount: apiKeys.length,
    });

    // 后台执行
    const results = await billingChecker.checkMultipleKeys(apiKeys, 10);
    billingChecker.generateReport(results);
    keyManager.reload();
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
});

/**
 * POST /admin/refresh - 执行密钥刷新
 */
router.post('/admin/refresh', async (req: Request, res: Response) => {
  try {
    // 加载密钥
    const keysDir = path.dirname(config.keysFile);
    const totalKeysFile = path.join(keysDir, 'total_keys.txt');
    let keysFile = config.keysFile;
    
    if (fs.existsSync(totalKeysFile)) {
      keysFile = totalKeysFile;
    }

    if (!fs.existsSync(keysFile)) {
      return res.status(400).json({
        success: false,
        error: '密钥文件不存在',
      });
    }

    const content = fs.readFileSync(keysFile, 'utf-8');
    const apiKeys = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    if (apiKeys.length === 0) {
      return res.status(400).json({
        success: false,
        error: '密钥文件为空',
      });
    }

    // 异步执行刷新
    res.json({
      success: true,
      message: `开始刷新 ${apiKeys.length} 个密钥，请稍后查看日志`,
      keysCount: apiKeys.length,
    });

    // 后台执行
    await keyRefresher.refreshAllKeys(apiKeys);
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
});

/**
 * POST /admin/daily-task - 手动触发每日任务
 */
router.post('/admin/daily-task', async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      message: '开始执行每日任务，请稍后查看日志',
    });

    // 后台执行
    await scheduler.runDailyTask();
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
});

// ==================== 模型端点 ====================

/**
 * GET /v1/models - 获取模型列表
 */
router.get('/v1/models', async (req: Request, res: Response) => {
  try {
    const refresh = req.query.refresh === 'true';
    const providerFilter = (req.query.provider as string | undefined)?.toLowerCase();

    // 检查缓存
    if (!refresh && modelsCache && Date.now() - modelsCacheTime < CACHE_TTL) {
      let models = modelsCache;
      if (providerFilter) {
        models = models.filter((m) => String(m.id).toLowerCase().startsWith(providerFilter));
      }
      return res.json({ object: 'list', data: models });
    }

    const apiKey = keyManager.getNextKey();

    // 尝试从上游获取
    if (apiKey) {
      try {
        const response = await fetch(`${config.upstreamOpenAIBaseUrl}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });

        if (response.ok) {
          const data = (await response.json()) as { data?: any[] };
          modelsCache = data.data || [];
          modelsCacheTime = Date.now();
          logger.info(`[MODELS] 从上游获取了 ${modelsCache.length} 个模型`);

          let models = modelsCache;
          if (providerFilter) {
            models = models.filter((m) => String(m.id).toLowerCase().startsWith(providerFilter));
          }
          return res.json({ object: 'list', data: models });
        }

        if (response.status === 429) {
          keyManager.markKeyFailed(apiKey);
        }
      } catch (error) {
        logger.warn('[MODELS] 从上游获取模型列表失败，使用内置列表');
      }
    }

    // 使用内置列表
    let models = getSupportedModels().map((m) => ({
      id: m.id,
      object: 'model',
      owned_by: m.provider,
    }));

    if (providerFilter) {
      models = models.filter((m) => String(m.id).toLowerCase().startsWith(providerFilter));
    }

    res.json({ object: 'list', data: models });
  } catch (error) {
    logger.error('[MODELS] 获取模型列表失败', error);
    res.status(500).json({ error: { message: 'Failed to get models', type: 'api_error' } });
  }
});

/**
 * GET /v1/models/:modelId - 获取单个模型
 *
 * 注意：AI Gateway 的 model id 形如 `openai/gpt-4o`，包含 `/`。
 * Express 默认的 `:param` 无法匹配包含 `/` 的参数，所以这里使用 `:modelId(*)`。
 */
router.get('/v1/models/:modelId(*)', async (req: Request, res: Response) => {
  try {
    const modelId = req.params.modelId;

    // 先用缓存
    if (modelsCache && Date.now() - modelsCacheTime < CACHE_TTL) {
      const found = modelsCache.find((m) => m.id === modelId);
      if (found) {
        return res.json(found);
      }
    }

    const apiKey = keyManager.getNextKey();

    if (apiKey) {
      try {
        const response = await fetch(
          `${config.upstreamOpenAIBaseUrl}/models/${encodeURIComponent(modelId)}`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
        );

        if (response.ok) {
          const data = await response.json();
          return res.json(data);
        }

        if (response.status === 429) {
          keyManager.markKeyFailed(apiKey);
        }
      } catch (error) {
        logger.warn('[MODELS] 从上游获取单模型失败，使用内置列表');
      }
    }

    const localModels = getSupportedModels();
    const found = localModels.find((m) => m.id === modelId || m.id.endsWith(`/${modelId}`));
    if (!found) {
      return res.status(404).json({ error: { message: 'Model not found', type: 'not_found' } });
    }

    res.json({ id: found.id, object: 'model', owned_by: found.provider });
  } catch (error) {
    logger.error('[MODELS] 获取单模型失败', error);
    res.status(500).json({ error: { message: 'Failed to get model', type: 'api_error' } });
  }
});

/**
 * POST /v1/chat/completions - 聊天完成（主要端点）
 */
router.post('/v1/chat/completions', async (req: Request, res: Response) => {
  const request = req.body as ChatCompletionRequest;

  if (!request?.model) {
    return res
      .status(400)
      .json({ error: { message: 'Missing required field: model', type: 'invalid_request_error' } });
  }

  if (!request?.messages || !Array.isArray(request.messages)) {
    return res.status(400).json({
      error: { message: 'Missing required field: messages', type: 'invalid_request_error' },
    });
  }

  const apiKey = keyManager.getNextKey();
  if (!apiKey) {
    return res
      .status(503)
      .json({ error: { message: 'No available API keys', type: 'service_error' } });
  }

  const normalizedModel = ensureGatewayModelId(request.model);
  const requestForSdk: ChatCompletionRequest = { ...request, model: normalizedModel };

  try {
    const result = await chatCompletion(requestForSdk, apiKey);

    if (request.stream && result.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const requestId = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      let clientClosed = false;
      req.on('close', () => {
        clientClosed = true;
      });

      try {
        // 兼容性：部分 OpenAI 生态客户端要求首包带 role
        const roleData = {
          id: requestId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: normalizedModel,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant' },
              finish_reason: null,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(roleData)}\n\n`);

        for await (const chunk of result.stream) {
          if (clientClosed) break;

          const data = {
            id: requestId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: normalizedModel,
            choices: [
              {
                index: 0,
                delta: { content: chunk },
                finish_reason: null,
              },
            ],
          };
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }

        if (!clientClosed) {
          const finalData = {
            id: requestId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: normalizedModel,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'stop',
              },
            ],
          };
          res.write(`data: ${JSON.stringify(finalData)}\n\n`);
          res.write('data: [DONE]\n\n');

          keyManager.markKeySuccess(apiKey);
        }
      } catch (streamError: any) {
        if (!clientClosed) {
          logger.error('流式响应错误:', streamError?.message);

          // 尝试发送错误
          const errorData = {
            id: requestId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: normalizedModel,
            choices: [
              {
                index: 0,
                delta: { content: `\n\n[Error: ${streamError?.message || 'stream_error'}]` },
                finish_reason: 'error',
              },
            ],
          };
          res.write(`data: ${JSON.stringify(errorData)}\n\n`);
          res.write('data: [DONE]\n\n');
        }
      }

      if (!res.writableEnded) {
        return res.end();
      }
      return;
    }

    // 非流式响应
    const requestId = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const response = {
      id: requestId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: normalizedModel,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: result.text || '',
            ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
          },
          finish_reason: 'stop',
        },
      ],
      usage: result.usage
        ? {
            prompt_tokens: result.usage.promptTokens,
            completion_tokens: result.usage.completionTokens,
            total_tokens: result.usage.totalTokens,
          }
        : undefined,
    };

    keyManager.markKeySuccess(apiKey);
    return res.json(response);
  } catch (error: any) {
    logger.error('聊天请求失败:', error?.message);

    if (shouldCooldownKeyByErrorMessage(error?.message)) {
      keyManager.markKeyFailed(apiKey);
    }

    return res.status(500).json({
      error: {
        message: error?.message || 'Internal server error',
        type: 'api_error',
      },
    });
  }
});

/**
 * POST /v1/completions - 兼容旧版 Completions
 */
router.post('/v1/completions', async (req: Request, res: Response) => {
  const model = req.body?.model;
  const prompt = req.body?.prompt;

  if (!model) {
    return res
      .status(400)
      .json({ error: { message: 'Missing required field: model', type: 'invalid_request_error' } });
  }

  if (typeof prompt !== 'string') {
    return res.status(400).json({
      error: { message: 'Missing required field: prompt (string)', type: 'invalid_request_error' },
    });
  }

  const apiKey = keyManager.getNextKey();
  if (!apiKey) {
    return res
      .status(503)
      .json({ error: { message: 'No available API keys', type: 'service_error' } });
  }

  const normalizedModel = ensureGatewayModelId(model);

  const chatRequest: ChatCompletionRequest = {
    model: normalizedModel,
    messages: [{ role: 'user', content: prompt }],
    stream: Boolean(req.body?.stream),
    temperature: req.body?.temperature,
    max_tokens: req.body?.max_tokens,
    top_p: req.body?.top_p,
  };

  try {
    const result = await chatCompletion(chatRequest, apiKey);

    // completions streaming
    if (chatRequest.stream && result.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const requestId = `cmpl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      let clientClosed = false;
      req.on('close', () => {
        clientClosed = true;
      });

      try {
        for await (const chunk of result.stream) {
          if (clientClosed) break;

          const data = {
            id: requestId,
            object: 'text_completion',
            created: Math.floor(Date.now() / 1000),
            model: normalizedModel,
            choices: [
              {
                text: chunk,
                index: 0,
                logprobs: null,
                finish_reason: null,
              },
            ],
          };
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }

        if (!clientClosed) {
          const finalData = {
            id: requestId,
            object: 'text_completion',
            created: Math.floor(Date.now() / 1000),
            model: normalizedModel,
            choices: [
              {
                text: '',
                index: 0,
                logprobs: null,
                finish_reason: 'stop',
              },
            ],
          };
          res.write(`data: ${JSON.stringify(finalData)}\n\n`);
          res.write('data: [DONE]\n\n');

          keyManager.markKeySuccess(apiKey);
        }
      } catch (streamError: any) {
        if (!clientClosed) {
          logger.error('completions 流式响应错误:', streamError?.message);
        }
      }

      if (!res.writableEnded) {
        return res.end();
      }
      return;
    }

    // completions non-stream
    const requestId = `cmpl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const response = {
      id: requestId,
      object: 'text_completion',
      created: Math.floor(Date.now() / 1000),
      model: normalizedModel,
      choices: [
        {
          text: result.text || '',
          index: 0,
          logprobs: null,
          finish_reason: 'stop',
        },
      ],
      usage: result.usage
        ? {
            prompt_tokens: result.usage.promptTokens,
            completion_tokens: result.usage.completionTokens,
            total_tokens: result.usage.totalTokens,
          }
        : undefined,
    };

    keyManager.markKeySuccess(apiKey);
    return res.json(response);
  } catch (error: any) {
    logger.error('completions 请求失败:', error?.message);

    if (shouldCooldownKeyByErrorMessage(error?.message)) {
      keyManager.markKeyFailed(apiKey);
    }

    return res.status(500).json({
      error: {
        message: error?.message || 'Internal server error',
        type: 'api_error',
      },
    });
  }
});

/**
 * 其他 OpenAI 兼容端点 (透传)
 * - 注意：这里转发到 AI Gateway 的 OpenAI-compatible base（默认 /v1）
 */
router.all('/v1/*', async (req: Request, res: Response) => {
  const apiKey = keyManager.getNextKey();
  if (!apiKey) {
    return res
      .status(503)
      .json({ error: { message: 'No available API keys', type: 'service_error' } });
  }

  try {
    // req.originalUrl: /v1/xxx?query
    // upstreamOpenAIBaseUrl 已经包含 /v1，所以这里要去掉前缀 /v1
    const upstreamPath = req.originalUrl.replace(/^\/v1/, '');
    const url = `${config.upstreamOpenAIBaseUrl}${upstreamPath}`;

    const response = await fetch(url, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    });

    if (response.status === 429) {
      keyManager.markKeyFailed(apiKey);
    } else if (response.ok) {
      keyManager.markKeySuccess(apiKey);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream') && response.body) {
      res.status(response.status);
      res.setHeader('Content-Type', contentType);
      // 透传 SSE 流
      Readable.fromWeb(response.body as any).pipe(res);
      return;
    }

    const text = await response.text();
    res.status(response.status);
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    res.send(text);
  } catch (error: any) {
    logger.error('代理请求失败:', error?.message);
    res.status(500).json({ error: { message: error?.message, type: 'api_error' } });
  }
});
