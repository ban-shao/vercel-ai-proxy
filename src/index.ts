import { config } from './config';
import { createServer } from './server';
import { logger } from './logger';
import { keyManager } from './key-manager';

async function main() {
  logger.info('============================================================');
  logger.info('Vercel AI Proxy - v1.0.0 (TypeScript + AI SDK)');
  logger.info('============================================================');
  logger.info(`监听端口: ${config.port}`);
  logger.info(`上游地址: ${config.upstreamUrl}`);
  logger.info(`已加载密钥: ${keyManager.getStats().total} 个`);
  logger.info('============================================================');
  
  const app = createServer();
  
  app.listen(config.port, () => {
    logger.info(`服务启动成功，监听端口 ${config.port}`);
  });
}

main().catch((error) => {
  logger.error('启动失败:', error);
  process.exit(1);
});
