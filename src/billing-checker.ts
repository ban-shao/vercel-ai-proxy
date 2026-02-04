/**
 * Vercel API Key 余额检查工具
 * 检查所有密钥余额并按范围分类保存
 */

import fs from 'fs';
import path from 'path';
import { config } from './config';
import { logger } from './logger';

interface KeyCheckResult {
  key: string;
  keyShort: string;
  status: 'success' | 'error';
  balance?: number;
  totalUsed?: number;
  totalLimit?: number;
  usagePercentage?: number;
  error?: string;
}

interface CheckSummary {
  total: number;
  successful: number;
  failed: number;
  totalBalance: number;
  totalUsed: number;
  totalLimit: number;
  categories: Record<string, number>;
}

interface BalanceCategory {
  name: string;
  min: number;
  max: number;
  keys: string[];
}

export class BillingChecker {
  private baseUrl: string;
  private keysDir: string;
  private reportsDir: string;

  constructor() {
    this.baseUrl = `${config.upstreamOpenAIBaseUrl.replace('/v1', '')}/v1`;
    this.keysDir = path.dirname(config.keysFile);
    this.reportsDir = path.join(path.dirname(this.keysDir), 'reports');

    // 确保目录存在
    if (!fs.existsSync(this.keysDir)) {
      fs.mkdirSync(this.keysDir, { recursive: true });
    }
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  /**
   * 检查单个密钥的余额
   */
  async checkSingleKey(apiKey: string): Promise<KeyCheckResult> {
    const keyShort = `${apiKey.substring(0, 16)}...${apiKey.slice(-4)}`;

    try {
      const response = await fetch(`${this.baseUrl}/credits`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': 'vercel-billing-checker/2.0',
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
          error: `HTTP ${response.status}: ${text.substring(0, 100)}`,
        };
      }
    } catch (error: any) {
      return {
        key: apiKey,
        keyShort,
        status: 'error',
        error: error?.message || 'Unknown error',
      };
    }
  }

  /**
   * 批量检查多个密钥（并发）
   */
  async checkMultipleKeys(apiKeys: string[], maxConcurrent = 5): Promise<KeyCheckResult[]> {
    const results: KeyCheckResult[] = [];
    const total = apiKeys.length;

    logger.info('='.repeat(60));
    logger.info(`开始检查 ${total} 个 Vercel API Key`);
    logger.info(`并发数: ${maxConcurrent}`);
    logger.info('='.repeat(60));

    const startTime = Date.now();

    // 分批并发执行
    for (let i = 0; i < apiKeys.length; i += maxConcurrent) {
      const batch = apiKeys.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(
        batch.map((key) => this.checkSingleKey(key))
      );

      for (const result of batchResults) {
        results.push(result);
        const progress = `[${results.length}/${total}]`;
        if (result.status === 'success') {
          logger.info(`${progress} ✅ ${result.keyShort} - 余额: $${result.balance?.toFixed(2)}`);
        } else {
          logger.info(`${progress} ❌ ${result.keyShort} - ${result.error?.substring(0, 50)}`);
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`\n检查完成，耗时: ${elapsed} 秒`);

    return results;
  }

  /**
   * 生成报告并保存分类文件
   */
  generateReport(results: KeyCheckResult[]): CheckSummary {
    const successful = results.filter((r) => r.status === 'success');
    const failed = results.filter((r) => r.status === 'error');

    logger.info('\n' + '='.repeat(60));
    logger.info('📊 检查完成 - 统计报告');
    logger.info('='.repeat(60));
    logger.info(`总计: ${results.length} 个密钥`);
    logger.info(`成功: ${successful.length} 个`);
    logger.info(`失败: ${failed.length} 个`);

    const summary: CheckSummary = {
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      totalBalance: 0,
      totalUsed: 0,
      totalLimit: 0,
      categories: {},
    };

    if (successful.length > 0) {
      const totalBalance = successful.reduce((sum, r) => sum + (r.balance || 0), 0);
      const totalUsed = successful.reduce((sum, r) => sum + (r.totalUsed || 0), 0);
      const totalLimit = successful.reduce((sum, r) => sum + (r.totalLimit || 0), 0);

      summary.totalBalance = Math.round(totalBalance * 100) / 100;
      summary.totalUsed = Math.round(totalUsed * 100) / 100;
      summary.totalLimit = Math.round(totalLimit * 100) / 100;

      logger.info('\n💰 余额统计:');
      logger.info(`   总余额: $${totalBalance.toFixed(2)}`);
      logger.info(`   总已用: $${totalUsed.toFixed(2)}`);
      logger.info(`   总额度: $${totalLimit.toFixed(2)}`);

      // 按余额分类
      const categories: Record<string, BalanceCategory> = {
        high: { name: '$3+', min: 3, max: Infinity, keys: [] },
        medium_high: { name: '$2-3', min: 2, max: 3, keys: [] },
        medium: { name: '$1-2', min: 1, max: 2, keys: [] },
        low: { name: '$0-1', min: 0.01, max: 1, keys: [] },
        zero: { name: '$0', min: -Infinity, max: 0.01, keys: [] },
      };

      // 按余额从高到低排序
      const successfulSorted = [...successful].sort((a, b) => (b.balance || 0) - (a.balance || 0));

      for (const r of successfulSorted) {
        const balance = r.balance || 0;
        for (const [catKey, catInfo] of Object.entries(categories)) {
          if (balance >= catInfo.min && balance < catInfo.max) {
            catInfo.keys.push(r.key);
            break;
          }
        }
      }

      logger.info('\n📈 余额分布:');
      for (const [catKey, catInfo] of Object.entries(categories)) {
        const count = catInfo.keys.length;
        if (count > 0) {
          logger.info(`   ${catInfo.name}: ${count} 个`);
        }
        summary.categories[catKey] = count;
      }

      // 保存有效密钥（余额>0）到 active_keys.txt
      const activeKeys: string[] = [];
      for (const catKey of ['high', 'medium_high', 'medium', 'low']) {
        activeKeys.push(...categories[catKey].keys);
      }

      if (activeKeys.length > 0) {
        const activeFile = path.join(this.keysDir, 'active_keys.txt');
        fs.writeFileSync(activeFile, activeKeys.join('\n'));
        logger.info(`\n✅ 已保存 ${activeKeys.length} 个有效密钥到: ${activeFile}`);
      }

      // 保存各分类
      for (const [catKey, catInfo] of Object.entries(categories)) {
        if (catInfo.keys.length > 0) {
          const catFile = path.join(this.keysDir, `keys_${catKey}.txt`);
          fs.writeFileSync(catFile, catInfo.keys.join('\n'));
          logger.info(`   - ${catInfo.name}: keys_${catKey}.txt (${catInfo.keys.length} 个)`);
        }
      }

      // 显示 Top 10
      logger.info('\n🏆 余额 Top 10:');
      for (let i = 0; i < Math.min(10, successfulSorted.length); i++) {
        const r = successfulSorted[i];
        logger.info(`   ${(i + 1).toString().padStart(2)}. ${r.keyShort} - $${r.balance?.toFixed(2)}`);
      }
    }

    // 保存 JSON 报告
    const report = {
      timestamp: new Date().toISOString(),
      summary,
      successful: successful
        .sort((a, b) => (b.balance || 0) - (a.balance || 0))
        .map((r) => ({
          keyShort: r.keyShort,
          balance: r.balance,
          totalUsed: r.totalUsed,
          totalLimit: r.totalLimit,
          usagePercentage: r.usagePercentage,
        })),
      failed: failed.map((r) => ({
        keyShort: r.keyShort,
        error: r.error,
      })),
    };

    const reportFile = path.join(this.reportsDir, 'billing_report.json');
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    logger.info(`\n📊 详细报告: ${reportFile}`);

    return summary;
  }
}

/**
 * 主函数 - 可作为独立脚本运行
 */
export async function runBillingCheck(): Promise<CheckSummary | null> {
  const keysFile = config.keysFile.replace('keys.txt', 'total_keys.txt');
  const fallbackFile = config.keysFile;

  let keysFilePath = keysFile;
  if (!fs.existsSync(keysFile)) {
    if (fs.existsSync(fallbackFile)) {
      keysFilePath = fallbackFile;
    } else {
      logger.error(`❌ 找不到密钥文件: ${keysFile}`);
      logger.error('\n请创建文件并添加密钥，每行一个');
      return null;
    }
  }

  const content = fs.readFileSync(keysFilePath, 'utf-8');
  const apiKeys = content
    .split('\n')
    .map((k) => k.trim())
    .filter((k) => k && !k.startsWith('#'));

  if (apiKeys.length === 0) {
    logger.error('❌ 密钥文件为空');
    return null;
  }

  logger.info(`✅ 读取到 ${apiKeys.length} 个密钥`);

  const checker = new BillingChecker();
  const results = await checker.checkMultipleKeys(apiKeys, 5);
  const summary = checker.generateReport(results);

  logger.info('\n' + '='.repeat(60));
  logger.info('✅ 检查完成！');
  logger.info('='.repeat(60));

  return summary;
}

// 支持直接运行
if (require.main === module) {
  runBillingCheck().then((summary) => {
    process.exit(summary ? 0 : 1);
  });
}
