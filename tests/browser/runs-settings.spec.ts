import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Library } from '../../src/server/library.js';
import { createHttpServer } from '../../src/server/http.js';
import { AppConfigSchema } from '../../src/domain/model-config.js';

test('checks models, preserves a task budget on unknown retry, replays and cancels', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '新建作品', exact: true }).click();
  await page.getByLabel('作品名称').fill('任务验收'); await page.getByLabel('作品文件夹').fill('task-flow');
  await page.getByRole('button', { name: '创建作品', exact: true }).click(); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('link', { name: '模型与设置', exact: true }).click();
  await page.getByLabel('请求次数上限').fill('3'); await page.getByLabel('token 总预算').fill('90000');
  await page.getByRole('button', { name: '应用预算', exact: true }).click();
  await page.getByRole('button', { name: '重新检查配置' }).click();
  await page.getByRole('button', { name: '探测模型', exact: true }).click();
  await expect(page.getByText('探测通过', { exact: true })).toBeVisible();
  if (await page.getByRole('button', { name: '关闭提示' }).count()) await page.getByRole('button', { name: '关闭提示' }).click();
  await page.screenshot({ path: '.tmp/ui-implementation/settings.png', fullPage: true });
  await page.getByRole('button', { name: '查看探测记录' }).click();
  await page.getByRole('button', { name: '只读重放', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('数据库变更：0');
  await page.getByRole('button', { name: '关闭对话框' }).click();
  await page.getByRole('link', { name: '规划', exact: true }).click();
  await page.getByLabel('创作要求', { exact: true }).fill('未知请求验收'); await page.getByRole('button', { name: '生成计划', exact: true }).click();
  await page.getByRole('link', { name: '任务记录', exact: true }).click();
  await page.getByRole('tab', { name: '待处理', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试未知请求', exact: true })).toBeDisabled();
  await expect(page.locator('.run-details')).toContainText('未知');
  if (await page.getByRole('button', { name: '关闭提示' }).count()) await page.getByRole('button', { name: '关闭提示' }).click();
  await page.screenshot({ path: '.tmp/ui-implementation/runs.png', fullPage: true });
  await page.getByLabel('我理解重试可能产生额外用量').check();
  await page.getByRole('button', { name: '重试未知请求', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看待处理提案' })).toBeVisible();
  await expect(page.locator('.run-details .key-values')).toContainText('2 / 3');
  await page.getByRole('link', { name: '规划', exact: true }).click();
  await page.getByRole('button', { name: '重新生成计划' }).click();
  await page.getByRole('dialog').getByLabel('创作要求', { exact: true }).fill('取消验收');
  await page.getByRole('dialog').getByRole('button', { name: '生成计划', exact: true }).click();
  await page.getByRole('link', { name: '任务记录', exact: true }).click();
  await page.getByRole('button', { name: '取消任务', exact: true }).click();
  await expect(page.locator('.run-row.selected')).toContainText('已取消');
});

test('disables model probing without credentials while retaining offline checks', async ({ page }) => {
  await mkdir('.tmp/ui-implementation', { recursive: true }); const folder = await mkdtemp(resolve('.tmp/ui-implementation/no-key-'));
  const library = new Library(folder); library.open('book', '缺失凭据验收');
  const key = `NOVEL_TEST_${randomUUID().replaceAll('-', '').toUpperCase()}`;
  const config = AppConfigSchema.parse({ schemaVersion: 1, model: { provider: 'openai-compatible', modelId: 'novel-model', baseURL: 'https://api.example.com/v1', apiKeyEnv: key, maxOutputTokens: 1024 } });
  const service = createHttpServer({ library, config: async () => ({ config, source: 'novel.config.json' }), staticDirectory: resolve('dist/web') });
  try {
    const url = await service.listen(0); await page.goto(`${url}/#/settings`);
    await expect(page.getByText('未配置', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '探测模型', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '重新检查配置' }).click();
    await expect(page.getByRole('status')).toContainText('本地环境与配置已重新检查');
  } finally { await new Promise<void>(resolveStop => service.server.close(() => resolveStop())); await rm(folder, { recursive: true }); }
});
