import fs from 'fs';
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
      const keysDir = require('path').dirname(config.keysFile);
      const keyFiles = [
        require('path').join(keysDir, 'keys_high.txt'),      // 优先使用高余额
        require('path').join(keysDir, 'active_keys.txt'),    // 其次有效密钥
        config.keysFile,                                      // 最后默认文件
      ];

      let loadedFile: string | null = null;
      let keyLines: string[] = [];

      for (const file of keyFiles) {
        if (fs.existsSync(file)) {
          const content = fs.readFileSync(file, 'utf-8');
          const lines = content
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#'));
          
          if (lines.length > 0) {
            keyLines = lines;
            loadedFile = file;
            break;
          }
        }
      }

      if (!loadedFile || keyLines.length === 0) {
        logger.warn(`密钥文件不存在或为空`);
        return;
      }

      // 保留现有密钥状态
      const existingKeys = new Map(this.keys.map((k) => [k.key, k]));

      this.keys = keyLines.map((key) => {
        const existing = existingKeys.get(key);
        return existing || { key, failCount: 0 };
      });

      this.lastLoadTime = Date.now();
      logger.info(`已从 ${require('path').basename(loadedFile)} 加载 ${this.keys.length} 个密钥`);
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
   * 手动重新加载密钥
   */
  reload() {
    this.loadKeys();
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
   * 获取详细状态（用于管理端点）
   */
  getDetailedStats() {
    const now = new Date();
    return {
      total: this.keys.length,
      available: this.keys.filter((k) => !k.cooldownUntil || k.cooldownUntil <= now).length,
      inCooldown: this.keys.filter((k) => k.cooldownUntil && k.cooldownUntil > now).length,
      keys: this.keys.map((k) => ({
        keyShort: `${k.key.slice(0, 10)}...${k.key.slice(-4)}`,
        failCount: k.failCount,
        inCooldown: k.cooldownUntil ? k.cooldownUntil > now : false,
        cooldownUntil: k.cooldownUntil?.toISOString(),
        lastUsed: k.usedAt?.toISOString(),
      })),
    };
  }

  /**
   * 重置所有密钥状态
   */
  resetAll() {
    for (const key of this.keys) {
      key.failCount = 0;
      key.cooldownUntil = undefined;
    }
    logger.info('已重置所有密钥状态');
  }
}

export const keyManager = new KeyManager();
