/**
 * Vercel API Key 自动刷新工具
 * 每天自动调用所有密钥，触发额度刷新机制
 */

import fs from 'fs';
import path from 'path';
import { config } from './config';
import { logger } from './logger';

interface RefreshResult {
  key: string;
  keyShort: string;
  status: 'success' | 'triggered' | 'timeout' | 'error';
  code?: number;
  message?: string;
  error?: string;
}

interface RefreshSummary {
  total: number;
  success: number;
  triggered: number;
  timeout: number;
  error: number;
  elapsedSeconds: number;
}

export class KeyRefresher {
  private baseUrl: string;
  private model: string;
  private interval: number;
  private reportsDir: string;

  constructor() {
    this.baseUrl = `${config.upstreamOpenAIBaseUrl.replace('/v1', '')}/v1/chat/completions`;
    // 使用最便宜的模型
    this.model = 'anthropic/claude-3-haiku';
    this.interval = 2000; // 每个密钥之间间隔毫秒数
    this.reportsDir = path.join(path.dirname(path.dirname(config.keysFile)), 'reports');

    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  /**
   * 刷新单个密钥
   */
  async refreshSingleKey(apiKey: string, index: number, total: number): Promise<RefreshResult> {
    const keyShort = `${apiKey.substring(0, 12)}...${apiKey.slice(-4)}`;

    const payload = {
      model: this.model,
      messages: [{ role: 'user', content: '1' }],
      max_tokens: 1,
    };

    try {
      logger.info(`[${index}/${total}] 正在刷新: ${keyShort}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        logger.info(`[${index}/${total}] ✅ ${keyShort} - 成功`);
        return {
          key: apiKey,
          keyShort,
          status: 'success',
          code: 200,
        };
      } else {
        // 即使失败也触发了刷新检查
        const text = await response.text();
        logger.info(`[${index}/${total}] ⚠️  ${keyShort} - HTTP ${response.status}`);
        return {
          key: apiKey,
          keyShort,
          status: 'triggered',
          code: response.status,
          message: text.substring(0, 100),
        };
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        logger.warn(`[${index}/${total}] ⏱️  ${keyShort} - 超时`);
        return {
          key: apiKey,
          keyShort,
          status: 'timeout',
        };
      }

      logger.error(`[${index}/${total}] ❌ ${keyShort} - ${error?.message}`);
      return {
        key: apiKey,
        keyShort,
        status: 'error',
        error: error?.message,
      };
    }
  }

  /**
   * 刷新所有密钥（顺序执行，带间隔）
   */
  async refreshAllKeys(apiKeys: string[]): Promise<RefreshResult[]> {
    const total = apiKeys.length;
    const results: RefreshResult[] = [];

    logger.info('='.repeat(60));
    logger.info('Vercel Key 刷新任务启动');
    logger.info(`密钥数量: ${total}`);
    logger.info(`间隔时间: ${this.interval / 1000} 秒`);
    logger.info('='.repeat(60));

    const startTime = Date.now();

    for (let i = 0; i < apiKeys.length; i++) {
      const result = await this.refreshSingleKey(apiKeys[i], i + 1, total);
      results.push(result);

      // 最后一个不需要等待
      if (i < apiKeys.length - 1) {
        await this.sleep(this.interval);
      }
    }

    const elapsed = (Date.now() - startTime) / 1000;

    // 统计
    const success = results.filter((r) => r.status === 'success').length;
    const triggered = results.filter((r) => r.status === 'triggered').length;
    const timeout = results.filter((r) => r.status === 'timeout').length;
    const error = results.filter((r) => r.status === 'error').length;

    logger.info('='.repeat(60));
    logger.info('刷新完成 - 统计报告');
    logger.info('='.repeat(60));
    logger.info(`总计: ${total}`);
    logger.info(`成功: ${success}`);
    logger.info(`触发: ${triggered}`);
    logger.info(`超时: ${timeout}`);
    logger.info(`错误: ${error}`);
    logger.info(`耗时: ${elapsed.toFixed(1)} 秒`);
    logger.info('='.repeat(60));

    // 保存报告
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total,
        success,
        triggered,
        timeout,
        error,
        elapsedSeconds: Math.round(elapsed * 100) / 100,
      } as RefreshSummary,
      details: results.map((r) => ({
        keyShort: r.keyShort,
        status: r.status,
        code: r.code,
        message: r.message,
        error: r.error,
      })),
    };

    const reportFile = path.join(this.reportsDir, 'refresh_report.json');
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    logger.info(`报告已保存: ${reportFile}`);

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * 主函数 - 可作为独立脚本运行
 */
export async function runKeyRefresh(): Promise<number> {
  const keysDir = path.dirname(config.keysFile);

  // 按优先级查找密钥文件
  const keyFiles = [
    path.join(keysDir, 'active_keys.txt'), // 优先使用有效密钥
    path.join(keysDir, 'total_keys.txt'),  // 备用：所有密钥
    config.keysFile,                        // 最后：默认文件
  ];

  let apiKeys: string[] = [];
  let usedFile = '';

  for (const keyFile of keyFiles) {
    if (fs.existsSync(keyFile)) {
      const content = fs.readFileSync(keyFile, 'utf-8');
      const keys = content
        .split('\n')
        .map((k) => k.trim())
        .filter((k) => k && !k.startsWith('#'));

      if (keys.length > 0) {
        apiKeys = keys;
        usedFile = keyFile;
        break;
      }
    }
  }

  if (apiKeys.length === 0) {
    logger.error('❌ 未找到密钥文件或文件为空');
    logger.error('   请确保以下文件之一存在且包含密钥:');
    for (const f of keyFiles) {
      logger.error(`   - ${f}`);
    }
    return 0;
  }

  logger.info(`从 ${path.basename(usedFile)} 读取 ${apiKeys.length} 个密钥`);

  const refresher = new KeyRefresher();
  const results = await refresher.refreshAllKeys(apiKeys);

  // 返回成功数量
  return results.filter((r) => r.status === 'success' || r.status === 'triggered').length;
}

// 支持直接运行
if (require.main === module) {
  runKeyRefresh().then((successCount) => {
    process.exit(successCount > 0 ? 0 : 1);
  });
}
