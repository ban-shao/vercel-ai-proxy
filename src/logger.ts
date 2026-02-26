import fs from 'fs';
import path from 'path';
import { config } from './config';

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

type LogLevel = keyof typeof LOG_LEVELS;

class Logger {
  private level: number;
  private logDir: string;
  private currentLogDate: string = '';
  private logStream: fs.WriteStream | null = null;

  constructor() {
    this.level = LOG_LEVELS[config.logLevel as LogLevel] ?? LOG_LEVELS.info;
    this.logDir = config.logDir;
    
    // 确保日志目录存在
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private getLogStream(): fs.WriteStream {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.currentLogDate || !this.logStream) {
      if (this.logStream) {
        this.logStream.end();
      }
      this.currentLogDate = today;
      const logFile = path.join(this.logDir, `${today}.log`);
      this.logStream = fs.createWriteStream(logFile, { flags: 'a' });
    }
    return this.logStream;
  }

  private formatMessage(level: string, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const formattedArgs = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    return `[${timestamp}] [${level.toUpperCase()}] ${message} ${formattedArgs}`.trim();
  }

  private log(level: LogLevel, message: string, ...args: any[]) {
    if (LOG_LEVELS[level] <= this.level) {
      const formatted = this.formatMessage(level, message, ...args);
      console.log(formatted);
      
      // 异步写入文件（使用 WriteStream，不阻塞事件循环）
      this.getLogStream().write(formatted + '\n');
    }
  }

  error(message: string, ...args: any[]) { this.log('error', message, ...args); }
  warn(message: string, ...args: any[]) { this.log('warn', message, ...args); }
  info(message: string, ...args: any[]) { this.log('info', message, ...args); }
  debug(message: string, ...args: any[]) { this.log('debug', message, ...args); }
}

export const logger = new Logger();
