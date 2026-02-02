import express from 'express';
import { authMiddleware, requestLogger, errorHandler } from './middleware';
import { router } from './routes';

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

  app.use(requestLogger);
  app.use(authMiddleware);

  app.use(router);

  // NOTE: errorHandler 必须放在最后
  app.use(errorHandler);

  return app;
}
