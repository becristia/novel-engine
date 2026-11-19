import { test, expect } from '@playwright/test';
import { captureLayouts } from './layout.js';

test('preserves belief, delays revelation, changes knowledge time and adopts chapter memory', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.getByRole('button', { name: '新建作品', exact: true }).click();
  await page.getByLabel('作品名称').fill('场景记忆验收'); await page.getByLabel('作品文件夹').fill('story-memory-flow');
  await page.getByRole('button', { name: '创建作品', exact: true }).click(); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('link', { name: '故事记忆', exact: true }).click(); await page.getByRole('tab', { name: '场景与认知', exact: true }).click();
  await page.getByRole('button', { name: '启用小说专用记忆' }).click();
  const save = async () => { await page.getByRole('button', { name: '保存故事记录', exact: true }).click(); await expect(page.getByRole('dialog')).not.toBeVisible(); };
  await page.getByRole('tab', { name: '人物身份', exact: true }).click();
  for (const name of ['林舟', '沈砚', '顾宁']) { await page.getByRole('button', { name: '新增人物身份' }).click(); await page.getByLabel('人物名称', { exact: true }).fill(name); await save(); }
  await page.getByRole('tab', { name: '故事事件', exact: true }).click();
  for (const title of ['调查', '揭示']) { await page.getByRole('button', { name: '新增故事事件' }).click(); await page.getByLabel('事件名称').fill(title); await page.getByLabel('事件状态').selectOption(title === '调查' ? 'actual' : 'planned'); await save(); }
  await page.getByRole('button', { name: '设置事件先后', exact: true }).click(); await page.getByRole('button', { name: '保存事件顺序' }).click(); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('tab', { name: '断言', exact: true }).click();
  await page.getByRole('button', { name: '新增断言' }).click(); await page.getByLabel('主体人物').selectOption({ label: '顾宁' }); await page.getByLabel('断言内容').fill('真凶'); await save();
  await page.getByRole('button', { name: '新增断言' }).click(); await page.getByLabel('主体人物').selectOption({ label: '沈砚' }); await page.getByLabel('断言内容').fill('林舟误以为是真凶'); await page.getByLabel('内容种类').selectOption('belief'); await page.getByLabel('想法或言语归属').selectOption({ label: '林舟' }); await page.getByLabel('披露范围').selectOption('public'); await save();
  await page.getByRole('tab', { name: '人物认知', exact: true }).click(); await page.getByRole('button', { name: '新增人物认知' }).click(); await page.getByLabel('认知人物').selectOption({ label: '林舟' }); await page.getByLabel('对应命题').selectOption({ label: '沈砚：林舟误以为是真凶' }); await page.getByLabel('认知态度').selectOption('believes'); await page.getByLabel('获知事件').selectOption({ label: '调查' }); await save();
  await page.getByRole('link', { name: '规划', exact: true }).click(); await page.getByLabel('创作要求', { exact: true }).fill('顺着信封调查。'); await page.getByLabel('本批章节数').fill('1'); await page.getByRole('button', { name: '生成计划', exact: true }).click();
  await page.getByLabel('场景 1 故事位置').selectOption({ label: '调查' }); await page.getByLabel('场景 2 故事位置').selectOption({ label: '调查' });
  await page.getByRole('button', { name: '保存计划修改' }).click(); await page.getByRole('button', { name: '批准本批 1 章' }).click();
  await page.getByRole('tab', { name: '上下文', exact: true }).click();
  await expect(page.locator('.context-list')).toContainText('林舟误以为是真凶'); await expect(page.locator('.context-list')).not.toContainText('顾宁');
  await page.getByRole('tab', { name: '审稿', exact: true }).click(); await page.getByRole('button', { name: '生成并审稿', exact: true }).click();
  await page.getByRole('button', { name: '批准为正式稿', exact: true }).click();
  await page.getByRole('tab', { name: '记忆变更', exact: true }).click(); await page.getByRole('button', { name: '采纳本章记忆变更' }).click();
  await expect(page.getByRole('button', { name: '采纳本章记忆变更' })).toBeDisabled();
  await page.getByRole('tab', { name: '上下文', exact: true }).click(); await expect(page.getByText('本次 Writer 实际保存的输入；后续编辑不会改写这份记录。')).toBeVisible();
  await page.getByRole('link', { name: '故事记忆', exact: true }).click(); await page.getByRole('tab', { name: '场景与认知', exact: true }).click();
  await page.getByRole('button', { name: '确认全部有效断言' }).click(); await expect(page.getByRole('button', { name: '确认全部有效断言' })).toBeDisabled();
  await page.getByRole('tab', { name: '人物认知', exact: true }).click(); await page.getByRole('button', { name: '编辑记录', exact: true }).click(); await page.getByLabel('获知事件').selectOption({ label: '揭示' }); await save();
  await page.getByLabel('预览目标场景').selectOption({ label: '调查信封' });
  await expect(page.locator('.story-memory .context-list')).not.toContainText('林舟误以为是真凶');
  await page.getByRole('tab', { name: '读者披露', exact: true }).click(); await page.getByRole('button', { name: '新增读者披露' }).click(); await page.getByLabel('披露命题').selectOption({ label: '顾宁：真凶' }); await page.getByLabel('披露场景').selectOption({ label: '查看封口' }); await page.getByLabel('披露程度').selectOption('reveal'); await save();
  await expect(page.locator('.story-memory .context-list')).not.toContainText('顾宁');
  if (await page.getByRole('button', { name: '关闭提示' }).count()) await page.getByRole('button', { name: '关闭提示' }).click();
  await captureLayouts(page, 'story-memory');
  await page.getByRole('tab', { name: '人物认知', exact: true }).click(); await page.getByRole('button', { name: '编辑记录', exact: true }).click(); await page.getByLabel('获知事件').selectOption({ label: '调查' });
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: '关闭对话框' }).click(); await expect(page.getByRole('dialog')).toBeVisible();
  await save(); expect(errors).toEqual([]);
});
