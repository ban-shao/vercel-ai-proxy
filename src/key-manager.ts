import fs from 'fs';
import path from 'path';
import { config } from './config';
import { logger } from './logger';
import { KeyStatus } from './types';

class KeyManager {
  private keys: KeyStatus[] = [];
  private currentIndex = 0;
  private lastLoadTime = 0;
  private readonly RELOAD_INTERVAL = 5 * 60 * 1000; // 5分钟重新加载

  constructor() {
    this.loadKeys();
  }

  private loadKeys() {
    try {
      // 按优先级查找密钥文件
      const keysDir = path.dirname(config.keysFile);
      const keyFiles = [
        path.join(keysDir, 'active_keys.txt'),  // 优先使用有效密钥
        path.join(keysDir, 'keys_high.txt'),    // 其次使用高余额密钥
        config.keysFile,                         // 最后使用默认文件
      ];

      let keysFilePath = '';
      for (const file of keyFiles) {
        if (fs.existsSync(file)) {
          const content = fs.readFileSync(file, 'utf-8');
          const lines = content.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
          if (lines.length > 0) {
            keysFilePath = file;
            break;
          }
        }
      }

      if (!keysFilePath) {
        logger.warn(`密钥文件不存在或为空`);
        return;
      }

      const content = fs.readFileSync(keysFilePath, 'utf-8');
      const keyLines = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));

      // 保留现有密钥状态
      const existingKeys = new Map(this.keys.map((k) => [k.key, k]));

      this.keys = keyLines.map((key) => {
        const existing = existingKeys.get(key);
        return existing || { key, failCount: 0 };
      });

      this.lastLoadTime = Date.now();
      logger.info(`已从 ${path.basename(keysFilePath)} 加载 ${this.keys.length} 个密钥`);
    } catch (error) {
      logger.error('加载密钥失败:', error);
    }
  }

  private maybeReloadKeys() {
    if (Date.now() - this.lastLoadTime > this.RELOAD_INTERVAL) {
      this.loadKeys();
    }
  }

  /**
   * 手动重新加载密钥（供 admin API 调用）
   */
  reloadKeys() {
    this.loadKeys();
  }

  /**
   * 重置所有密钥状态（清除冷却）
   */
  resetAllKeys() {
    for (const key of this.keys) {
      key.failCount = 0;
      key.cooldownUntil = undefined;
    }
    this.currentIndex = 0;
    logger.info('所有密钥状态已重置');
  }

  getNextKey(): string | null {
    this.maybeReloadKeys();

    if (this.keys.length === 0) {
      return null;
    }

    const now = new Date();

    // 尝试找到可用的密钥
    for (let i = 0; i < this.keys.length; i++) {
      const index = (this.currentIndex + i) % this.keys.length;
      const keyStatus = this.keys[index];

      // 检查是否在冷却中
      if (keyStatus.cooldownUntil && keyStatus.cooldownUntil > now) {
        continue;
      }

      this.currentIndex = (index + 1) % this.keys.length;
      keyStatus.usedAt = now;
      return keyStatus.key;
    }

    // 所有密钥都在冷却中，返回第一个
    logger.warn('所有密钥都在冷却中，强制使用第一个');
    this.currentIndex = this.keys.length > 1 ? 1 : 0;
    return this.keys[0].key;
  }

  markKeyFailed(key: string) {
    const keyStatus = this.keys.find((k) => k.key === key);
    if (keyStatus) {
      keyStatus.failCount++;
      keyStatus.cooldownUntil = new Date(
        Date.now() + config.cooldownHours * 60 * 60 * 1000,
      );
      logger.warn(`密钥标记为冷却: ${key.substring(0, 10)}...`);
    }
  }

  markKeySuccess(key: string) {
    const keyStatus = this.keys.find((k) => k.key === key);
    if (keyStatus) {
      keyStatus.failCount = 0;
      keyStatus.cooldownUntil = undefined;
    }
  }

  getStats() {
    const now = new Date();
    const available = this.keys.filter((k) => !k.cooldownUntil || k.cooldownUntil <= now).length;
    return {
      total: this.keys.length,
      available,
      inCooldown: this.keys.length - available,
    };
  }

  /**
   * 获取详细的密钥状态（供 admin API 使用）
   */
  getDetailedStatus() {
    const now = new Date();
    return this.keys.map((k) => ({
      keyShort: `${k.key.substring(0, 12)}...${k.key.slice(-4)}`,
      failCount: k.failCount,
      inCooldown: k.cooldownUntil ? k.cooldownUntil > now : false,
      cooldownUntil: k.cooldownUntil?.toISOString(),
      lastUsed: k.usedAt?.toISOString(),
    }));
  }
}

export const keyManager = new KeyManager();
