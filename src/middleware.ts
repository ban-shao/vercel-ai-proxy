import { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { logger } from './logger';

/**
 * 认证中间件
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // 跳过健康检查
  if (req.path === '/health') {
    return next();
  }

  // 未配置 AUTH_KEY 时不启用鉴权
  if (!config.authKey) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    logger.warn(`[AUTH] 缺少认证头 - ${req.ip}`);
    return res.status(401).json({
      error: {
        message: 'Unauthorized: Missing Authorization header',
        type: 'auth_error',
      },
    });
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (token !== config.authKey) {
    logger.warn(`[AUTH] 认证失败 - ${req.ip}`);
    return res.status(401).json({
      error: {
        message: 'Unauthorized: Invalid API key',
        type: 'auth_error',
      },
    });
  }

  next();
}

/**
 * 请求日志中间件
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](`[HTTP] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });

  next();
}

/**
 * 错误处理中间件
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  logger.error(`[ERROR] ${err.message}`, err.stack);

  res.status(500).json({
    error: {
      message: err.message,
      type: 'api_error',
    },
  });
}
