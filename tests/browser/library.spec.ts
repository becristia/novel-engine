import { test, expect } from '@playwright/test';

test('creates a real workspace, previews and imports a manuscript, then reopens it', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '新建作品', exact: true }).click();
  await page.getByLabel('作品名称').fill('雾港来信');
  await page.getByLabel('作品文件夹').fill('harbor-import');
  await page.getByRole('button', { name: '创建作品', exact: true }).click();
  await expect(page.getByText('新作品 · 尚无正式稿')).toBeVisible();
  await page.getByLabel('选择稿件').setInputFiles({ name: '雾港来信.md', mimeType: 'text/markdown', buffer: Buffer.from('## 雨夜归港\n\n雨停以后，林舟走进码头。\n\n## 封存的信\n\n他把那封没有署名的信放在灯下。\n\n## 旧伤\n\n右手骨折，三天内不可执笔。') });
  await expect(page.getByRole('cell', { name: '雨夜归港', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认导入 3 章' })).toBeEnabled();
  await page.getByRole('button', { name: '关闭提示' }).click();
  await page.screenshot({ path: '.tmp/ui-implementation/library.png', fullPage: true });
  await page.getByRole('button', { name: '确认导入 3 章' }).click();
  await expect(page.getByText('3 章正式稿', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('3 章正式稿', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('preserves the form on an invalid path and reaches every navigation entry', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '打开工作区', exact: true }).click();
  await page.getByLabel('作品文件夹').fill('../outside');
  await page.getByRole('button', { name: '打开作品', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('工作区必须位于');
  await expect(page.getByLabel('作品文件夹')).toHaveValue('../outside');
  await page.getByRole('button', { name: '关闭对话框' }).click();
  for (const [label, heading] of [['章节工作台', '章节工作台'], ['规划', '章节规划'], ['故事记忆', '故事记忆'], ['局部改稿', '局部改稿'], ['任务记录', '任务记录'], ['版本与导出', '版本与导出'], ['模型与设置', '模型与设置']]) {
    await page.getByRole('link', { name: label!, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading!, exact: true, level: 1 })).toBeVisible();
  }
});
