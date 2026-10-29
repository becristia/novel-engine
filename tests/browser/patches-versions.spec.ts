import { test, expect } from '@playwright/test';
import { captureLayouts } from './layout.js';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function createImported(page: Page, title: string, directory: string) {
  await page.goto('/'); await page.getByRole('button', { name: '新建作品', exact: true }).click();
  await page.getByLabel('作品名称').fill(title); await page.getByLabel('作品文件夹').fill(directory);
  await page.getByRole('button', { name: '创建作品', exact: true }).click(); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByLabel('选择稿件').setInputFiles({ name: `${title}.md`, mimeType: 'text/markdown', buffer: Buffer.from('## 封存的信\n\n林舟已经知道，信里提到的船长就是失踪多年的父亲。\n\n潮水淹没了石阶，远处的航灯仍亮着。\n\n## 灯下的名单\n\n林舟把父亲的身份写在了名单上。\n\n## 旧日航灯\n\n林舟望向远处的灯光，等待着下一次涨潮。') });
  await page.getByRole('button', { name: '确认导入 3 章' }).click(); await expect(page.getByRole('button', { name: `${title} 3 章正式稿` })).toBeVisible();
}

test('previews actual groups, respects dependencies and locks, reviews each selected chapter and undoes atomically', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await createImported(page, '改稿验收', 'patch-flow');
  await page.getByRole('link', { name: '章节工作台', exact: true }).click();
  await page.locator('.reading-paper [data-block="b3"]').hover(); await page.getByRole('button', { name: '锁定段落 b3', exact: true }).click();
  await expect(page.getByRole('button', { name: '解除段落 b3 的锁定', exact: true })).toBeVisible();
  await page.locator('.sidebar-chapters>button').filter({ hasText: '旧日航灯' }).click();
  await page.locator('.reading-paper [data-block="b2"]').hover(); await page.getByRole('button', { name: '锁定段落 b2', exact: true }).click();
  await expect(page.getByRole('button', { name: '解除段落 b2 的锁定', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '局部改稿', exact: true }).click();
  await page.getByLabel('修改要求', { exact: true }).fill('把林舟得知父亲身份的时间推迟到第六章。');
  await page.getByRole('button', { name: '分析改稿影响', exact: true }).click();
  await expect(page.getByLabel('选择修改组 02')).toBeVisible(); await page.getByLabel('选择修改组 02').click();
  await page.getByRole('dialog').getByRole('button', { name: '同时选择依赖组', exact: true }).click();
  await expect(page.getByLabel('选择修改组 01')).toBeChecked();
  await page.getByLabel('选择修改组 03').check(); await expect(page.getByText('修改触碰锁定范围。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '生成所选候选', exact: true })).toBeDisabled();
  await page.getByLabel('选择修改组 03').uncheck(); await expect(page.getByRole('button', { name: '生成所选候选', exact: true })).toBeEnabled();
  await page.getByLabel('差异章节').selectOption({ label: '第 1 章 · 封存的信' });
  await expect(page.locator('.diff-columns')).toContainText('锁定段落');
  if (await page.getByRole('button', { name: '关闭提示' }).count()) await page.getByRole('button', { name: '关闭提示' }).click();
  await captureLayouts(page, 'patches');
  await page.getByRole('button', { name: '生成所选候选', exact: true }).click();
  await expect(page.getByRole('button', { name: '批准所选方案', exact: true })).toBeDisabled();
  for (const number of [1, 2]) {
    await page.getByRole('button', { name: `审稿第 ${number} 章`, exact: true }).click();
    await expect(page.locator('.selection-chapters>div').filter({ hasText: `第 ${number} 章` }).getByText('已审稿', { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: '批准所选方案', exact: true }).click();
  await expect(page.getByRole('button', { name: '预览撤回所选方案', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '预览撤回所选方案', exact: true }).click(); await page.getByRole('button', { name: '确认撤回', exact: true }).click();
  await expect(page.getByRole('button', { name: '预览撤回所选方案', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: '章节工作台', exact: true }).click();
  await page.locator('.sidebar-chapters>button').filter({ hasText: '封存的信' }).click();
  await expect(page.locator('.reading-paper')).toContainText('就是失踪多年的父亲');
  await expect(page.getByRole('button', { name: '解除段落 b3 的锁定' })).toBeVisible();
  await page.getByRole('button', { name: '解除段落 b3 的锁定' }).click();
  await expect(page.getByRole('button', { name: '编辑正式稿', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('exports a selected historical snapshot, restores as a new version and reorders current chapters', async ({ page }) => {
  await createImported(page, '版本验收', 'version-flow');
  await page.getByRole('link', { name: '章节工作台', exact: true }).click();
  await page.getByRole('button', { name: '编辑正式稿', exact: true }).click();
  await page.getByRole('dialog').getByLabel('正文', { exact: true }).fill('作者更新后的第一章。');
  await page.getByRole('button', { name: '预览差异', exact: true }).click(); await page.getByRole('button', { name: '保存为新版本', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('link', { name: '版本与导出', exact: true }).click();
  await page.getByRole('button', { name: '查看作品版本 1', exact: true }).click();
  await expect(page.locator('.version-paper')).toContainText('就是失踪多年的父亲');
  if (await page.getByRole('button', { name: '关闭提示' }).count()) await page.getByRole('button', { name: '关闭提示' }).click();
  await captureLayouts(page, 'versions');
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: '导出版本 1', exact: true }).click();
  const download = await downloadPromise; const text = await readFile((await download.path())!, 'utf8');
  expect(download.suggestedFilename()).toBe('版本验收-v1.md'); expect(text).toContain('就是失踪多年的父亲'); expect(text).not.toContain('作者更新后的第一章');
  await page.getByRole('button', { name: '预览恢复此章', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('作者更新后的第一章');
  await page.getByRole('button', { name: '确认恢复为新版本', exact: true }).click();
  await expect(page.getByText('当前正式版本 3', { exact: true })).toBeVisible();
  await page.getByText('调整当前章节顺序', { exact: true }).click();
  await page.getByRole('button', { name: '下移 封存的信', exact: true }).click();
  await expect(page.getByText('当前正式版本 4', { exact: true })).toBeVisible();
  await expect(page.getByLabel('历史章节').locator('option').first()).toHaveText('第 1 章 · 灯下的名单');
});
