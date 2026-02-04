#!/usr/bin/env tsx
import 'dotenv/config';
import { runDailyTask } from '../daily-task.js';

async function main() {
  console.log('\n📅 开始执行每日任务...\n');
  
  await runDailyTask();
  
  console.log('\n✅ 每日任务完成');
}

main().catch(console.error);
