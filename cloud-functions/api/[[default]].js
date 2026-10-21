/**
 * EdgeOne Pages 云函数入口：所有 /api/* 请求都走这里。
 *
 * 需要的环境变量（在 EdgeOne 控制台 → 项目设置 → 环境变量 里配置）：
 *   CLASS_CODE      班级口令（必填，默认 888888）
 *   ADMIN_CODE      导出备份用的口令（可选，默认与班级口令相同）
 *   RETENTION_DAYS  照片保留天数（可选，默认 120）
 */
import { getStore } from '@edgeone/pages-blob';
import { createHandler } from './_app.mjs';

const store = getStore('class-checkin');

const handle = createHandler(store, {
  CLASS_CODE: process.env.CLASS_CODE || '888888',
  ADMIN_CODE: process.env.ADMIN_CODE || '',
  RETENTION_DAYS: process.env.RETENTION_DAYS || '120',
});

export default async function onRequest(context) {
  return handle(context.request);
}
