/**
 * 定时任务调度器
 * 支持每日自动执行密钥管理任务
 */

import { config } from './config';
import { logger } from './logger';
import { runDailyTask } from './daily-task';

interface SchedulerOptions {
  /** 每日执行时间，格式: "HH:MM"，默认 "00:00" */
  dailyTime?: string;
  /** 是否启用调度器 */
  enabled?: boolean;
}

class Scheduler {
  private dailyTimer: NodeJS.Timeout | null = null;
  private enabled: boolean;
  private dailyTime: { hour: number; minute: number };

  constructor(options: SchedulerOptions = {}) {
    this.enabled = options.enabled ?? (process.env.SCHEDULER_ENABLED === 'true');

    // 解析每日执行时间
    const timeStr = options.dailyTime || process.env.DAILY_TASK_TIME || '00:00';
    const [hour, minute] = timeStr.split(':').map(Number);
    this.dailyTime = {
      hour: isNaN(hour) ? 0 : hour,
      minute: isNaN(minute) ? 0 : minute,
    };
  }

  /**
   * 启动调度器
   */
  start(): void {
    if (!this.enabled) {
      logger.info('[Scheduler] 定时任务调度器已禁用');
      logger.info('[Scheduler] 设置 SCHEDULER_ENABLED=true 环境变量以启用');
      return;
    }

    logger.info('[Scheduler] 定时任务调度器已启动');
    logger.info(`[Scheduler] 每日任务执行时间: ${this.dailyTime.hour.toString().padStart(2, '0')}:${this.dailyTime.minute.toString().padStart(2, '0')}`);

    this.scheduleDailyTask();
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (this.dailyTimer) {
      clearTimeout(this.dailyTimer);
      this.dailyTimer = null;
    }
    logger.info('[Scheduler] 定时任务调度器已停止');
  }

  /**
   * 安排每日任务
   */
  private scheduleDailyTask(): void {
    const now = new Date();
    const nextRun = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      this.dailyTime.hour,
      this.dailyTime.minute,
      0,
      0
    );

    // 如果今天的时间已过，安排到明天
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    const delay = nextRun.getTime() - now.getTime();
    const hoursUntil = Math.floor(delay / 1000 / 60 / 60);
    const minutesUntil = Math.floor((delay / 1000 / 60) % 60);

    logger.info(`[Scheduler] 下次执行时间: ${nextRun.toISOString()} (${hoursUntil}小时${minutesUntil}分钟后)`);

    this.dailyTimer = setTimeout(async () => {
      logger.info('[Scheduler] 开始执行每日任务...');

      try {
        await runDailyTask();
        logger.info('[Scheduler] 每日任务执行完成');
      } catch (error: any) {
        logger.error(`[Scheduler] 每日任务执行失败: ${error?.message}`);
      }

      // 安排下一次执行
      this.scheduleDailyTask();
    }, delay);
  }

  /**
   * 立即执行每日任务（手动触发）
   */
  async runNow(): Promise<void> {
    logger.info('[Scheduler] 手动触发每日任务...');
    await runDailyTask();
  }
}

// 导出单例
export const scheduler = new Scheduler();

// 支持直接运行（立即执行一次）
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--daemon') || args.includes('-d')) {
    // 守护进程模式：启动调度器
    const s = new Scheduler({ enabled: true });
    s.start();

    // 保持进程运行
    process.on('SIGINT', () => {
      s.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      s.stop();
      process.exit(0);
    });
  } else {
    // 默认：立即执行一次
    runDailyTask().then(() => {
      process.exit(0);
    }).catch((error) => {
      logger.error('执行失败:', error);
      process.exit(1);
    });
  }
}
