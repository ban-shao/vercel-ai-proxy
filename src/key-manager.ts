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
      if (!fs.existsSync(config.keysFile)) {
        logger.warn(`密钥文件不存在: ${config.keysFile}`);
        return;
      }

      const content = fs.readFileSync(config.keysFile, 'utf-8');
      const keyLines = content.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

      // 保留现有密钥状态
      const existingKeys = new Map(this.keys.map(k => [k.key, k]));
      
      this.keys = keyLines.map(key => {
        const existing = existingKeys.get(key);
        return existing || { key, failCount: 0 };
      });

      this.lastLoadTime = Date.now();
      logger.info(`已加载 ${this.keys.length} 个密钥`);
    } catch (error) {
      logger.error('加载密钥失败:', error);
    }
  }

  private maybeReloadKeys() {
    if (Date.now() - this.lastLoadTime > this.RELOAD_INTERVAL) {
      this.loadKeys();
    }
  }

  getNextKey(): string | null {
    this.maybeReloadKeys();

    if (this.keys.length === 0) {
      return null;
    }

    const now = new Date();
    const cooldownMs = config.cooldownHours * 60 * 60 * 1000;

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
    this.currentIndex = 1;
    return this.keys[0].key;
  }

  markKeyFailed(key: string) {
    const keyStatus = this.keys.find(k => k.key === key);
    if (keyStatus) {
      keyStatus.failCount++;
      keyStatus.cooldownUntil = new Date(Date.now() + config.cooldownHours * 60 * 60 * 1000);
      logger.warn(`密钥标记为冷却: ${key.substring(0, 10)}...`);
    }
  }

  markKeySuccess(key: string) {
    const keyStatus = this.keys.find(k => k.key === key);
    if (keyStatus) {
      keyStatus.failCount = 0;
      keyStatus.cooldownUntil = undefined;
    }
  }

  getStats() {
    const now = new Date();
    const available = this.keys.filter(k => !k.cooldownUntil || k.cooldownUntil <= now).length;
    return {
      total: this.keys.length,
      available,
      inCooldown: this.keys.length - available,
    };
  }
}

export const keyManager = new KeyManager();
