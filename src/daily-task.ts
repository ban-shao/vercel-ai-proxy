/**
 * Vercel Gateway 每日定时任务
 * 完整流程：刷新密钥 -> 检查余额 -> 更新有效密钥 -> 通知代理服务热加载
 */

import fs from 'fs';
import path from 'path';
import { config } from './config';
import { logger } from './logger';
import { keyRefresher } from './key-refresher';
import { billingChecker } from './billing-checker';

/**
 * 步骤1: 刷新所有密钥
 */
async function runRefresh(): Promise<boolean> {
  logger.info('='.repeat(60));
  logger.info('📍 步骤 1/3: 刷新所有密钥额度');
  logger.info('='.repeat(60));

  try {
    const keysDir = path.dirname(config.keysFile);
    const keysFile = path.join(keysDir, 'total_keys.txt');

    if (!fs.existsSync(keysFile)) {
      // 尝试使用默认密钥文件
      if (!fs.existsSync(config.keysFile)) {
        logger.error(`❌ 密钥文件不存在: ${keysFile}`);
        return false;
      }
    }

    const targetFile = fs.existsSync(keysFile) ? keysFile : config.keysFile;
    const content = fs.readFileSync(targetFile, 'utf-8');
    const apiKeys = content
      .split('\n')
      .map((k) => k.trim())
      .filter((k) => k && !k.startsWith('#'));

    if (apiKeys.length === 0) {
      logger.error('❌ 密钥文件为空');
      return false;
    }

    logger.info(`读取到 ${apiKeys.length} 个密钥`);

    const results = await keyRefresher.refreshAllKeys(apiKeys);

    const success = results.filter((r) => r.status === 'success' || r.status === 'triggered').length;
    logger.info(`✅ 刷新完成: ${success}/${apiKeys.length} 个密钥已触发`);

    return true;
  } catch (error: any) {
    logger.error(`❌ 刷新失败: ${error?.message}`);
    return false;
  }
}

/**
 * 步骤2: 检查所有密钥余额
 */
async function runCheck(): Promise<boolean> {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('📍 步骤 2/3: 检查所有密钥余额');
  logger.info('='.repeat(60));

  try {
    const keysDir = path.dirname(config.keysFile);
    const keysFile = path.join(keysDir, 'total_keys.txt');
    const targetFile = fs.existsSync(keysFile) ? keysFile : config.keysFile;

    const content = fs.readFileSync(targetFile, 'utf-8');
    const apiKeys = content
      .split('\n')
      .map((k) => k.trim())
      .filter((k) => k && !k.startsWith('#'));

    if (apiKeys.length === 0) {
      logger.error('❌ 密钥文件为空');
      return false;
    }

    const results = await billingChecker.checkMultipleKeys(apiKeys, 10);
    billingChecker.generateReport(results);

    // 统计
    const successful = results.filter((r) => r.status === 'success');
    const highBalance = successful.filter((r) => (r.balance || 0) >= 3).length;

    logger.info(`✅ 检查完成: ${successful.length}/${apiKeys.length} 个有效`);
    logger.info(`   高余额密钥($3+): ${highBalance} 个`);

    return true;
  } catch (error: any) {
    logger.error(`❌ 检查失败: ${error?.message}`);
    return false;
  }
}

/**
 * 步骤3: 通知代理服务重新加载密钥
 */
async function notifyProxyReload(): Promise<boolean> {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('📍 步骤 3/3: 通知代理服务热加载密钥');
  logger.info('='.repeat(60));

  if (!config.authKey) {
    logger.warn('⚠️ 未配置 AUTH_KEY，跳过热加载通知');
    logger.info('   请手动重启服务');
    return true;
  }

  try {
    const url = `http://127.0.0.1:${config.port}/admin/reload`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.authKey}`,
      },
    });

    if (response.ok) {
      const data = await response.json() as { message?: string };
      logger.info(`✅ 代理服务已重新加载密钥: ${data.message || 'OK'}`);
      return true;
    } else {
      logger.warn(`⚠️ 热加载请求失败: HTTP ${response.status}`);
      logger.info('   请手动重启服务');
      return true;
    }
  } catch (error: any) {
    if (error?.cause?.code === 'ECONNREFUSED') {
      logger.warn('⚠️ 代理服务未运行，跳过热加载');
    } else {
      logger.warn(`⚠️ 热加载失败: ${error?.message}`);
    }
    return true;
  }
}

/**
 * 主函数 - 执行完整的每日任务
 */
export async function runDailyTask(): Promise<void> {
  const startTime = Date.now();

  logger.info('');
  logger.info('╔' + '═'.repeat(58) + '╗');
  logger.info('║' + '  Vercel Gateway 每日定时任务'.padStart(38).padEnd(56) + '║');
  logger.info('║' + `  ${new Date().toISOString()}`.padEnd(56) + '║');
  logger.info('╚' + '═'.repeat(58) + '╝');
  logger.info('');

  // 步骤1: 刷新密钥
  const refreshOk = await runRefresh();

  if (!refreshOk) {
    logger.error('刷新失败，但继续执行检查...');
  }

  // 等待一会，让刷新生效
  logger.info('\n⏳ 等待 30 秒让额度刷新生效...');
  await new Promise((resolve) => setTimeout(resolve, 30000));

  // 步骤2: 检查余额
  const checkOk = await runCheck();

  if (!checkOk) {
    logger.error('检查失败');
    process.exit(1);
  }

  // 步骤3: 通知代理热加载
  await notifyProxyReload();

  // 完成
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  logger.info('');
  logger.info('╔' + '═'.repeat(58) + '╗');
  logger.info('║' + '  ✅ 每日任务完成！'.padStart(34).padEnd(54) + '║');
  logger.info('║' + `  总耗时: ${elapsed} 秒`.padEnd(54) + '║');
  logger.info('╚' + '═'.repeat(58) + '╝');

  // 显示当前密钥状态
  const keysDir = path.dirname(config.keysFile);
  const keysHighFile = path.join(keysDir, 'keys_high.txt');

  if (fs.existsSync(keysHighFile)) {
    const content = fs.readFileSync(keysHighFile, 'utf-8');
    const count = content.split('\n').filter((k) => k.trim()).length;
    logger.info(`\n📊 当前高余额密钥: ${count} 个`);
    logger.info(`   文件: ${keysHighFile}`);
  }
}

// 支持直接运行
if (require.main === module) {
  runDailyTask().then(() => {
    process.exit(0);
  }).catch((error) => {
    logger.error('每日任务执行失败:', error);
    process.exit(1);
  });
}
