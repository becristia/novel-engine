import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function captureLayouts(page: Page, name: string): Promise<void> {
  const viewport = page.viewportSize()!;
  await page.screenshot({ path: `.tmp/ui-implementation/${name}.png`, fullPage: true });
  for (const width of [1024, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.locator('main').evaluate(element => element.scrollWidth - element.clientWidth), `${name} at ${width}px`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `.tmp/ui-implementation/${name}-${width}.png`, fullPage: false });
    const lastAction = page.locator('main button:visible').last();
    await lastAction.scrollIntoViewIfNeeded(); await expect(lastAction).toBeInViewport({ ratio: 0.95 });
    await page.locator('main').evaluate(element => element.scrollTo(0, 0));
  }
  await page.setViewportSize(viewport);
}
