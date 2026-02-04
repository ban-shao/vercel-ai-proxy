import { config } from './config';
import { logger } from './logger';
import { createServer } from './server';
import { scheduler } from './scheduler';

async function main() {
  logger.info('Starting Vercel AI Proxy...');
  logger.info(`Version: 1.1.0`);
  logger.info(`Port: ${config.port}`);
  logger.info(`Upstream: ${config.upstreamUrl}`);
  logger.info(`Keys file: ${config.keysFile}`);
  logger.info(`Cooldown hours: ${config.cooldownHours}`);
  logger.info(`Scheduler: ${config.enableScheduler ? 'enabled' : 'disabled'}`);
  if (config.enableScheduler) {
    logger.info(`Daily task time: ${config.dailyTaskTime}`);
  }

  const app = createServer();

  app.listen(config.port, () => {
    logger.info(`Server is running on port ${config.port}`);
    logger.info(`Health check: http://localhost:${config.port}/health`);
    logger.info(`API endpoint: http://localhost:${config.port}/v1/chat/completions`);
    
    // 启动定时任务调度器
    if (config.enableScheduler) {
      scheduler.start();
    }
  });
}

main().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
