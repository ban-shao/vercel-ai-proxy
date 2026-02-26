/**
 * 定时任务调度器
 * 支持每日自动执行刷新和检查任务
 */

import fs from 'fs';
import path from 'path';
import { config } from './config';
import { logger } from './logger';
import { keyManager } from './key-manager';
import { billingChecker } from './billing-checker';
import { keyRefresher } from './key-refresher';

export class Scheduler {
  private dailyTaskTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * 启动定时任务调度器
   */
  start() {
    if (!config.enableScheduler) {
      logger.info('定时任务调度器已禁用');
      return;
    }

    logger.info('╔' + '═'.repeat(58) + '╗');
    logger.info('║' + '  定时任务调度器已启动'.padStart(35).padEnd(58) + '║');
    logger.info('║' + `  每日执行时间: ${config.dailyTaskTime}`.padStart(35).padEnd(58) + '║');
    logger.info('╚' + '═'.repeat(58) + '╝');

    // 计算下次执行时间
    this.scheduleNextRun();
  }

  /**
   * 停止定时任务调度器
   */
  stop() {
    if (this.dailyTaskTimer) {
      clearTimeout(this.dailyTaskTimer);
      this.dailyTaskTimer = null;
    }
    logger.info('定时任务调度器已停止');
  }

  /**
   * 计算并安排下次执行
   */
  private scheduleNextRun() {
    const [hours, minutes] = config.dailyTaskTime.split(':').map(Number);
    const now = new Date();
    const next = new Date();

    next.setHours(hours, minutes, 0, 0);

    // 如果今天的时间已过，安排明天
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    const delay = next.getTime() - now.getTime();
    const hoursUntil = Math.floor(delay / (1000 * 60 * 60));
    const minutesUntil = Math.floor((delay % (1000 * 60 * 60)) / (1000 * 60));

    logger.info(`下次定时任务将在 ${hoursUntil}小时${minutesUntil}分钟 后执行 (${next.toLocaleString()})`);

    this.dailyTaskTimer = setTimeout(() => {
      this.runDailyTask();
    }, delay);
  }

  /**
   * 执行每日任务
   */
  async runDailyTask(): Promise<{ refresh: boolean; check: boolean; reload: boolean }> {
    if (this.isRunning) {
      logger.warn('定时任务正在执行中，跳过本次执行');
      return { refresh: false, check: false, reload: false };
    }

    this.isRunning = true;
    const startTime = Date.now();

    logger.info('');
    logger.info('╔' + '═'.repeat(58) + '╗');
    logger.info('║' + '  Vercel AI Proxy 每日定时任务'.padStart(35).padEnd(58) + '║');
    logger.info('║' + `  ${new Date().toLocaleString()}`.padStart(35).padEnd(58) + '║');
    logger.info('╚' + '═'.repeat(58) + '╝');
    logger.info('');

    const result = { refresh: false, check: false, reload: false };

    try {
      // 步骤1: 刷新密钥
      logger.info('='.repeat(60));
      logger.info('📍 步骤 1/3: 刷新所有密钥额度');
      logger.info('='.repeat(60));

      result.refresh = await this.runRefresh();

      if (!result.refresh) {
        logger.error('刷新失败，但继续执行检查...');
      }

      // 等待一会，让刷新生效
      logger.info('');
      logger.info('⏳ 等待 30 秒让额度刷新生效...');
      await this.sleep(30000);

      // 步骤2: 检查余额
      logger.info('');
      logger.info('='.repeat(60));
      logger.info('📍 步骤 2/3: 检查所有密钥余额');
      logger.info('='.repeat(60));

      result.check = await this.runCheck();

      // 步骤3: 通知代理热加载
      logger.info('');
      logger.info('='.repeat(60));
      logger.info('📍 步骤 3/3: 热加载密钥');
      logger.info('='.repeat(60));

      result.reload = this.runReload();

    } catch (error: any) {
      logger.error(`每日任务执行出错: ${error.message}`);
    } finally {
      this.isRunning = false;

      const elapsed = (Date.now() - startTime) / 1000;

      logger.info('');
      logger.info('╔' + '═'.repeat(58) + '╗');
      logger.info('║' + '  ✅ 每日任务完成！'.padStart(35).padEnd(58) + '║');
      logger.info('║' + `  总耗时: ${elapsed.toFixed(1)} 秒`.padStart(35).padEnd(58) + '║');
      logger.info('╚' + '═'.repeat(58) + '╝');

      // 安排下次执行
      this.scheduleNextRun();
    }

    return result;
  }

  /**
   * 执行刷新任务
   */
  async runRefresh(): Promise<boolean> {
    try {
      const apiKeys = this.loadKeys();
      if (apiKeys.length === 0) {
        logger.error('❌ 没有找到密钥');
        return false;
      }

      logger.info(`读取到 ${apiKeys.length} 个密钥`);

      const results = await keyRefresher.refreshAllKeys(apiKeys);
      const success = results.filter((r) => r.status === 'success' || r.status === 'triggered').length;

      logger.info(`✅ 刷新完成: ${success}/${apiKeys.length} 个密钥已触发`);
      return true;
    } catch (error: any) {
      logger.error(`❌ 刷新失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 执行检查任务
   */
  async runCheck(): Promise<boolean> {
    try {
      const apiKeys = this.loadKeys();
      if (apiKeys.length === 0) {
        logger.error('❌ 没有找到密钥');
        return false;
      }

      const results = await billingChecker.checkMultipleKeys(apiKeys, 10);
      billingChecker.generateReport(results);

      const successful = results.filter((r) => r.status === 'success');
      const highBalance = successful.filter((r) => (r.balance || 0) >= 3);

      logger.info(`✅ 检查完成: ${successful.length}/${apiKeys.length} 个有效`);
      logger.info(`   高余额密钥($3+): ${highBalance.length} 个`);

      return true;
    } catch (error: any) {
      logger.error(`❌ 检查失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 执行热加载
   */
  runReload(): boolean {
    try {
      keyManager.reload();
      logger.info('✅ 密钥已重新加载');
      return true;
    } catch (error: any) {
      logger.error(`❌ 热加载失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 加载密钥文件
   */
  private loadKeys(): string[] {
    // 优先使用 total_keys.txt
    const keysDir = path.dirname(config.keysFile);
    const totalKeysFile = path.join(keysDir, 'total_keys.txt');

    let keysFile = config.keysFile;
    if (fs.existsSync(totalKeysFile)) {
      keysFile = totalKeysFile;
    }

    if (!fs.existsSync(keysFile)) {
      return [];
    }

    const content = fs.readFileSync(keysFile, 'utf-8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const scheduler = new Scheduler();
