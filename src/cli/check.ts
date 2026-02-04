#!/usr/bin/env tsx
import 'dotenv/config';
import fs from 'fs';
import { config } from '../config.js';
import { billingChecker } from '../billing-checker.js';

async function main() {
  console.log('\n🔍 开始检查密钥余额...\n');

  const keysFile = config.keysFile;
  
  if (!fs.existsSync(keysFile)) {
    console.error(`❌ 密钥文件不存在: ${keysFile}`);
    process.exit(1);
  }

  const keys = fs.readFileSync(keysFile, 'utf-8')
    .split('\n')
    .map(k => k.trim())
    .filter(k => k && !k.startsWith('#'));

  if (keys.length === 0) {
    console.error('❌ 没有找到有效密钥');
    process.exit(1);
  }

  console.log(`📂 密钥文件: ${keysFile}`);
  console.log(`🔑 密钥数量: ${keys.length}\n`);

  const results = await billingChecker.checkMultipleKeys(keys);
  billingChecker.generateReport(results);
  
  console.log('\n✅ 检查完成');
}

main().catch(console.error);
