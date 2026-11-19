import { z } from 'zod';
import { ConfigurationError } from '../llm/config.js';

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function publicError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof HttpError) return { status: error.status, code: error.code, message: error.message };
  if (error instanceof z.ZodError || error instanceof SyntaxError) return { status: 400, code: 'invalid-input', message: '输入格式不正确，请检查必填字段和数值范围。' };
  if (error instanceof ConfigurationError) return { status: 400, code: 'configuration', message: '模型配置无效，请检查本机配置文件。' };
  // Domain errors have fixed, application-authored Chinese messages. Never expose IO,
  // SDK, raw JSON or arbitrary exceptions that may contain private configuration.
  const message = error instanceof Error ? error.message : '';
  const allowed = /^(项目|本章|本作品|前序章节|计划|候选|提案|该提案|旧提案|只能|不能|需要|缺少|存在|部分结果|部分采纳|正式|章节|修改|所选|引用|锁定|区块|运行|模型计划|上下文|最近正文|预算|同一|事实|确认|纠正|人物身份|替换正文|插入位置|排序|工作区|指定|旧运行|正文|原修改|创建运行|当前|导入|稿件|内容|场景|记忆|叙述|检索)/u;
  if (message.length < 250 && allowed.test(message) && !/[\r\n{}]/u.test(message)) {
    return { status: 409, code: /版本|过期/u.test(message) ? 'version-conflict' : 'domain-rejected', message };
  }
  return { status: 500, code: 'operation-failed', message: '操作未完成，请检查本地配置、输入和任务记录。' };
}
