/**
 * Vercel API Key 自动刷新工具
 * 每天自动调用所有密钥，触发额度刷新机制
 */

import fs from 'fs';
import path from 'path';
import { config } from './config';
import { logger } from './logger';

export interface RefreshResult {
  key: string;
  keyShort: string;
  status: 'success' | 'triggered' | 'timeout' | 'error';
  code?: number;
  message?: string;
  error?: string;
}

export interface RefreshSummary {
  total: number;
  success: number;
  triggered: number;
  timeout: number;
  error: number;
  elapsedSeconds: number;
}

export class KeyRefresher {
  private baseUrl = 'https://ai-gateway.vercel.sh/v1/chat/completions';
  private model = 'anthropic/claude-3-haiku'; // 使用最便宜的模型
  private interval = 2000; // 每个密钥之间间隔毫秒数

  /**
   * 刷新单个密钥
   */
  async refreshSingleKey(apiKey: string, index: number, total: number): Promise<RefreshResult> {
    const keyShort = `${apiKey.slice(0, 12)}...${apiKey.slice(-4)}`;

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
          message: text.slice(0, 100),
        };
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        logger.warn(`[${index}/${total}] ⏱️  ${keyShort} - 超时`);
        return {
          key: apiKey,
          keyShort,
          status: 'timeout',
        };
      }

      logger.error(`[${index}/${total}] ❌ ${keyShort} - ${error.message}`);
      return {
        key: apiKey,
        keyShort,
        status: 'error',
        error: error.message,
      };
    }
  }

  /**
   * 刷新所有密钥
   */
  async refreshAllKeys(apiKeys: string[]): Promise<RefreshResult[]> {
    const total = apiKeys.length;
    const results: RefreshResult[] = [];

    logger.info('='.repeat(60));
    logger.info('Vercel Key 刷新任务启动');
    logger.info(`密钥数量: ${total}`);
    logger.info(`间隔时间: ${this.interval}ms`);
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
    const summary: RefreshSummary = {
      total,
      success: results.filter((r) => r.status === 'success').length,
      triggered: results.filter((r) => r.status === 'triggered').length,
      timeout: results.filter((r) => r.status === 'timeout').length,
      error: results.filter((r) => r.status === 'error').length,
      elapsedSeconds: Math.round(elapsed * 10) / 10,
    };

    logger.info('='.repeat(60));
    logger.info('刷新完成 - 统计报告');
    logger.info('='.repeat(60));
    logger.info(`总计: ${summary.total}`);
    logger.info(`成功: ${summary.success}`);
    logger.info(`触发: ${summary.triggered}`);
    logger.info(`超时: ${summary.timeout}`);
    logger.info(`错误: ${summary.error}`);
    logger.info(`耗时: ${summary.elapsedSeconds} 秒`);
    logger.info('='.repeat(60));

    // 保存报告
    this.saveReport(results, summary);

    return results;
  }

  /**
   * 保存刷新报告
   */
  private saveReport(results: RefreshResult[], summary: RefreshSummary) {
    const reportsDir = path.join(path.dirname(config.keysFile), '..', 'reports');

    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const report = {
      timestamp: new Date().toISOString(),
      summary,
      details: results.map((r) => ({
        keyShort: r.keyShort,
        status: r.status,
        code: r.code,
        message: r.message,
        error: r.error,
      })),
    };

    const reportFile = path.join(reportsDir, 'refresh_report.json');
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    logger.info(`报告已保存: ${reportFile}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const keyRefresher = new KeyRefresher();
