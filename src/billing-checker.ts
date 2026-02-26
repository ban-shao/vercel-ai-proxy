/**
 * Vercel API Key 余额检查工具
 * 检查所有密钥余额并按范围分类保存
 */

import fs from 'fs';
import path from 'path';
import { config } from './config';
import { logger } from './logger';

export interface BillingResult {
  key: string;
  keyShort: string;
  status: 'success' | 'error';
  balance?: number;
  totalUsed?: number;
  totalLimit?: number;
  usagePercentage?: number;
  error?: string;
}

export interface BillingSummary {
  total: number;
  successful: number;
  failed: number;
  totalBalance: number;
  totalUsed: number;
  totalLimit: number;
  categories: {
    high: number;      // $3+
    mediumHigh: number; // $2-3
    medium: number;    // $1-2
    low: number;       // $0-1
    zero: number;      // $0
  };
}

export class BillingChecker {
  private get baseUrl() { return config.upstreamOpenAIBaseUrl; }

  /**
   * 检查单个密钥的余额
   */
  async checkSingleKey(apiKey: string): Promise<BillingResult> {
    const keyShort = `${apiKey.slice(0, 16)}...${apiKey.slice(-4)}`;

    try {
      const response = await fetch(`${this.baseUrl}/credits`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': 'vercel-ai-proxy-billing-checker/1.0',
        },
      });

      if (response.ok) {
        const data = await response.json() as { balance?: number; total_used?: number };
        const balance = Number(data.balance || 0);
        const totalUsed = Number(data.total_used || 0);
        const totalLimit = balance + totalUsed;
        const usagePercentage = totalLimit > 0 ? Math.round((totalUsed / totalLimit) * 10000) / 100 : 0;

        return {
          key: apiKey,
          keyShort,
          status: 'success',
          balance,
          totalUsed,
          totalLimit,
          usagePercentage,
        };
      } else {
        const text = await response.text();
        return {
          key: apiKey,
          keyShort,
          status: 'error',
          error: `HTTP ${response.status}: ${text.slice(0, 100)}`,
        };
      }
    } catch (error: any) {
      return {
        key: apiKey,
        keyShort,
        status: 'error',
        error: error.message || 'Unknown error',
      };
    }
  }

  /**
   * 批量检查多个密钥（并发）
   */
  async checkMultipleKeys(apiKeys: string[], maxConcurrency = 5): Promise<BillingResult[]> {
    const results: BillingResult[] = [];
    const total = apiKeys.length;

    logger.info(`开始检查 ${total} 个密钥余额...`);

    // 分批并发执行
    for (let i = 0; i < apiKeys.length; i += maxConcurrency) {
      const batch = apiKeys.slice(i, i + maxConcurrency);
      const batchResults = await Promise.all(
        batch.map((key) => this.checkSingleKey(key))
      );

      for (const result of batchResults) {
        results.push(result);
        const completed = results.length;
        if (result.status === 'success') {
          logger.info(`[${completed}/${total}] ✅ ${result.keyShort} - 余额: $${result.balance?.toFixed(2)}`);
        } else {
          logger.warn(`[${completed}/${total}] ❌ ${result.keyShort} - ${result.error?.slice(0, 50)}`);
        }
      }
    }

    return results;
  }

  /**
   * 生成报告并保存分类文件
   */
  generateReport(results: BillingResult[]): BillingSummary {
    const successful = results.filter((r) => r.status === 'success');
    const failed = results.filter((r) => r.status === 'error');

    // 按余额分类
    const categories = {
      high: [] as string[],      // $3+
      mediumHigh: [] as string[], // $2-3
      medium: [] as string[],    // $1-2
      low: [] as string[],       // $0.01-1
      zero: [] as string[],      // $0
    };

    // 按余额从高到低排序
    const sortedSuccessful = successful.sort((a, b) => (b.balance || 0) - (a.balance || 0));

    for (const r of sortedSuccessful) {
      const balance = r.balance || 0;
      if (balance >= 3) {
        categories.high.push(r.key);
      } else if (balance >= 2) {
        categories.mediumHigh.push(r.key);
      } else if (balance >= 1) {
        categories.medium.push(r.key);
      } else if (balance >= 0.01) {
        categories.low.push(r.key);
      } else {
        categories.zero.push(r.key);
      }
    }

    const summary: BillingSummary = {
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      totalBalance: successful.reduce((sum, r) => sum + (r.balance || 0), 0),
      totalUsed: successful.reduce((sum, r) => sum + (r.totalUsed || 0), 0),
      totalLimit: successful.reduce((sum, r) => sum + (r.totalLimit || 0), 0),
      categories: {
        high: categories.high.length,
        mediumHigh: categories.mediumHigh.length,
        medium: categories.medium.length,
        low: categories.low.length,
        zero: categories.zero.length,
      },
    };

    logger.info('='.repeat(60));
    logger.info('📊 检查完成 - 统计报告');
    logger.info('='.repeat(60));
    logger.info(`总计: ${summary.total} 个密钥`);
    logger.info(`成功: ${summary.successful} 个`);
    logger.info(`失败: ${summary.failed} 个`);
    logger.info('');
    logger.info('💰 余额统计:');
    logger.info(`   总余额: $${summary.totalBalance.toFixed(2)}`);
    logger.info(`   总已用: $${summary.totalUsed.toFixed(2)}`);
    logger.info(`   总额度: $${summary.totalLimit.toFixed(2)}`);
    logger.info('');
    logger.info('📈 余额分布:');
    logger.info(`   $3+: ${summary.categories.high} 个`);
    logger.info(`   $2-3: ${summary.categories.mediumHigh} 个`);
    logger.info(`   $1-2: ${summary.categories.medium} 个`);
    logger.info(`   $0-1: ${summary.categories.low} 个`);
    logger.info(`   $0: ${summary.categories.zero} 个`);

    // 保存分类文件
    this.saveKeyFiles(categories);

    // 保存 JSON 报告
    this.saveReport(results, summary);

    return summary;
  }

  /**
   * 保存分类密钥文件
   */
  private saveKeyFiles(categories: Record<string, string[]>) {
    const keysDir = path.dirname(config.keysFile);

    // 确保目录存在
    if (!fs.existsSync(keysDir)) {
      fs.mkdirSync(keysDir, { recursive: true });
    }

    // 保存有效密钥（余额>0）
    const activeKeys = [
      ...categories.high,
      ...categories.mediumHigh,
      ...categories.medium,
      ...categories.low,
    ];

    if (activeKeys.length > 0) {
      const activeFile = path.join(keysDir, 'active_keys.txt');
      fs.writeFileSync(activeFile, activeKeys.join('\n'));
      logger.info(`✅ 已保存 ${activeKeys.length} 个有效密钥到: ${activeFile}`);
    }

    // 保存各分类
    const categoryFiles: Record<string, string> = {
      high: 'keys_high.txt',
      mediumHigh: 'keys_medium_high.txt',
      medium: 'keys_medium.txt',
      low: 'keys_low.txt',
      zero: 'keys_zero.txt',
    };

    for (const [category, filename] of Object.entries(categoryFiles)) {
      const keys = categories[category];
      if (keys && keys.length > 0) {
        const filePath = path.join(keysDir, filename);
        fs.writeFileSync(filePath, keys.join('\n'));
        logger.info(`   - ${filename}: ${keys.length} 个`);
      }
    }
  }

  /**
   * 保存 JSON 报告
   */
  private saveReport(results: BillingResult[], summary: BillingSummary) {
    const reportsDir = path.join(path.dirname(config.keysFile), '..', 'reports');

    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const report = {
      timestamp: new Date().toISOString(),
      summary,
      successful: results
        .filter((r) => r.status === 'success')
        .sort((a, b) => (b.balance || 0) - (a.balance || 0))
        .map((r) => ({
          keyShort: r.keyShort,
          balance: r.balance,
          totalUsed: r.totalUsed,
          totalLimit: r.totalLimit,
          usagePercentage: r.usagePercentage,
        })),
      failed: results
        .filter((r) => r.status === 'error')
        .map((r) => ({
          keyShort: r.keyShort,
          error: r.error,
        })),
    };

    const reportFile = path.join(reportsDir, 'billing_report.json');
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    logger.info(`📊 详细报告: ${reportFile}`);
  }
}

export const billingChecker = new BillingChecker();
