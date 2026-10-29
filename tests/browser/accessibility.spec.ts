import { test, expect } from '@playwright/test';

test('serves static assets and rejects missing or malformed paths with accurate status codes', async ({ request }) => {
  const home = await request.get('/'); expect(home.status()).toBe(200);
  const html = await home.text(); const favicon = /rel="icon"[^>]*href="([^"]+)"/u.exec(html)?.[1];
  expect(favicon).toBeTruthy(); expect((await request.get(favicon!)).status()).toBe(200);
  expect((await request.get('/missing-asset.js')).status()).toBe(404);
  expect((await request.get('/assets/')).status()).toBe(404);
  expect((await request.get('/%E0%A4')).status()).toBe(400);
  expect((await request.get('/%00')).status()).toBe(400);
  expect((await request.post('/')).status()).toBe(405);
  expect((await request.head('/')).status()).toBe(200);
});

test('keeps narrow navigation named, dialogs keyboard-operable and chapter selection available', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 }); await page.goto('/');
  for (const name of ['作品入口', '章节工作台', '规划', '故事记忆', '局部改稿', '任务记录', '版本与导出', '模型与设置']) {
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: '选择作品', exact: true })).toBeVisible();
  const create = page.getByRole('button', { name: '新建作品', exact: true });
  await create.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('作品名称')).toBeFocused();
  await page.keyboard.type('Keyboard workspace'); await page.keyboard.press('Tab');
  await expect(page.getByLabel('作品文件夹')).toBeFocused();
  await page.keyboard.type('keyboard-workspace'); await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: '创建作品', exact: true })).toBeFocused();
  await page.getByLabel('作品名称').focus(); await page.keyboard.press('Shift+Tab'); await expect(page.getByRole('button', { name: '关闭对话框' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(create).toBeFocused(); await page.keyboard.press('Enter');
  await page.getByLabel('作品文件夹').focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('新作品 · 尚无正式稿').last()).toBeVisible();
  await page.getByLabel('选择稿件').setInputFiles({ name: 'keyboard.md', mimeType: 'text/markdown', buffer: Buffer.from('## 第一章\n\n初见。\n\n## 第二章\n\n再访。') });
  await page.getByRole('button', { name: '确认导入 2 章' }).click();
  await page.getByRole('link', { name: '章节工作台', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('main h1')).toHaveText('第一章');
  const chapterPicker = page.getByRole('combobox', { name: '选择章节' });
  await chapterPicker.selectOption({ index: 1 });
  await expect(page.locator('main h1')).toHaveText('第二章');
  await page.getByRole('tab', { name: '审稿', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '本章计划', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: '本章计划', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End'); await expect(page.getByRole('tab', { name: '上下文', exact: true })).toBeFocused();
  await page.keyboard.press('Home'); await expect(page.getByRole('tab', { name: '审稿', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '新增章节', exact: true }).click();
  await page.getByLabel('章节标题').fill('尚未保存的新章');
  page.once('dialog', dialog => void dialog.dismiss()); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog').getByLabel('章节标题')).toHaveValue('尚未保存的新章');
  page.once('dialog', dialog => void dialog.accept()); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
