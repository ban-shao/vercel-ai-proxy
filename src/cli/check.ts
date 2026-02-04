#!/usr/bin/env tsx
import 'dotenv/config';
import { BillingChecker } from '../billing-checker.js';

async function main() {
  console.log('\n🔍 开始检查密钥余额...\n');
  
  const checker = new BillingChecker();
  await checker.checkAllKeys();
  
  console.log('\n✅ 检查完成');
}

main().catch(console.error);
