import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  authKey: process.env.AUTH_KEY || '',
  upstreamUrl: process.env.UPSTREAM_URL || 'https://ai-gateway.vercel.sh',
  keysFile: process.env.KEYS_FILE || './data/keys/keys_high.txt',
  cooldownHours: parseInt(process.env.COOLDOWN_HOURS || '24', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  logDir: process.env.LOG_DIR || './logs',
};
