#!/usr/bin/env tsx
import 'dotenv/config';
import { KeyRefresher } from '../key-refresher.js';

async function main() {
  console.log('\n🔄 开始刷新密钥额度...\n');
  
  const refresher = new KeyRefresher();
  await refresher.refreshAllKeys();
  
  console.log('\n✅ 刷新完成');
}

main().catch(console.error);
