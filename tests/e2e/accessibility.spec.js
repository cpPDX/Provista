const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

function parseRgb(value) {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Could not parse color: ${value}`);
  return channels;
}

function relativeLuminance(rgb) {
  const channels = rgb.map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(parseRgb(first)), relativeLuminance(parseRgb(second)));
  const darker = Math.min(relativeLuminance(parseRgb(first)), relativeLuminance(parseRgb(second)));
  return (lighter + 0.05) / (darker + 0.05);
}

test.describe('Mobile accessibility foundation', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginAsNewUser(page, baseURL);
  });

  test('meets AA contrast for brand actions and muted card text', async ({ page }) => {
    const colors = await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.className = 'card';
      fixture.innerHTML = '<span class="text-muted">Muted card copy</span><button class="btn btn-primary">Primary action</button>';
      document.body.appendChild(fixture);
      const card = getComputedStyle(fixture);
      const muted = getComputedStyle(fixture.querySelector('.text-muted'));
      const button = getComputedStyle(fixture.querySelector('.btn-primary'));
      const result = {
        cardBackground: card.backgroundColor,
        mutedText: muted.color,
        buttonBackground: button.backgroundColor,
        buttonText: button.color
      };
      fixture.remove();
      return result;
    });

    expect(contrastRatio(colors.buttonText, colors.buttonBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.mutedText, colors.cardBackground)).toBeGreaterThanOrEqual(4.5);
  });

  test('exposes shopping controls to keyboard and assistive technology with 44px targets', async ({ page }) => {
    const itemResponse = await page.request.post('/api/items', {
      data: { name: `Accessible Item ${Date.now()}`, category: 'Other', unit: 'each' }
    });
    const item = await itemResponse.json();
    await page.request.post('/api/shopping-list', { data: { itemId: item._id, quantity: 1 } });
    await page.click('[data-tab="list"]');

    const check = page.getByRole('button', { name: `Mark as purchased ${item.name}` });
    await expect(check).toHaveAttribute('aria-pressed', 'false');
    await check.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: `Uncheck ${item.name}` })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /Done shopping with 1 item/ })).toBeVisible();
    await expect(page.locator('#cart-bar-summary')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('#cart-bar-summary').press('Enter');
    await expect(page.locator('#cart-bar-summary')).toHaveAttribute('aria-expanded', 'true');

    const undersized = await page.evaluate(() => {
      const selectors = [
        '#btn-add-list-item',
        '#btn-list-filter',
        '.list-item-check-wrap',
        '.list-item-remove',
        '#cart-bar-summary',
        '#btn-done-shopping',
        '#cart-more-menu > summary',
        '.bottom-nav .nav-item'
      ];
      return selectors.flatMap(selector => [...document.querySelectorAll(selector)])
        .filter(element => element.offsetParent !== null)
        .map(element => {
          const rect = element.getBoundingClientRect();
          return { selector: element.id || element.className, width: rect.width, height: rect.height };
        })
        .filter(target => target.width < 44 || target.height < 44);
    });
    expect(undersized).toEqual([]);
  });

  test('gives modals dialog semantics, traps focus, and restores the trigger', async ({ page }) => {
    await page.click('[data-tab="list"]');
    const trigger = page.locator('#btn-add-list-item');
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Add to Shopping List' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('#modal-overlay')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#app')).toHaveAttribute('inert', '');
    await expect(page.locator('#list-item-input')).toBeFocused();

    const submit = page.getByRole('button', { name: 'Add to List' });
    await submit.focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#modal-close')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(submit).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(page.locator('#modal-overlay')).toHaveAttribute('aria-hidden', 'true');
    await expect(trigger).toBeFocused();
  });

  test('supports keyboard-only item creation and accessible filter sheets', async ({ page }) => {
    await page.click('[data-tab="list"]');
    const addTrigger = page.locator('#btn-add-list-item');
    await addTrigger.click();
    const input = page.locator('#list-item-input');
    const name = `Keyboard Item ${Date.now()}`;
    await input.fill(name);
    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await input.press('ArrowDown');
    const create = page.locator('#list-item-dropdown .autocomplete-create');
    await expect(create).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#list-new-item-fields')).toBeVisible();
    await page.keyboard.press('Escape');

    const filterTrigger = page.locator('#btn-list-filter');
    await filterTrigger.focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: 'Filter List' });
    await expect(sheet).toBeVisible();
    await expect(page.locator('#filter-sheet-overlay')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#app')).toHaveAttribute('inert', '');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(filterTrigger).toBeFocused();
  });

  test('announces toasts and removes nonessential motion when requested', async ({ page }) => {
    const toast = page.getByRole('status');
    await page.evaluate(() => showToast('Pantry update saved', 5000));
    await expect(toast).toContainText('Pantry update saved');
    await expect(toast).toHaveAttribute('aria-live', 'polite');
    await expect(toast).toHaveAttribute('aria-atomic', 'true');

    const motion = await page.evaluate(() => {
      const toastStyle = getComputedStyle(document.getElementById('toast'));
      const buttonStyle = getComputedStyle(document.getElementById('home-quick-add'));
      return {
        animationDuration: parseFloat(toastStyle.animationDuration) || 0,
        transitionDuration: parseFloat(buttonStyle.transitionDuration) || 0
      };
    });
    expect(motion.animationDuration).toBeLessThanOrEqual(0.00001);
    expect(motion.transitionDuration).toBeLessThanOrEqual(0.00001);
  });

  test('reflows at 200% text and reserves the iPhone safe-area navigation boundary', async ({ page }) => {
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('viewport-fit=cover');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await page.click('[data-tab="list"]');
    await expect(page.locator('#btn-add-list-item')).toBeVisible();

    const layout = await page.evaluate(() => {
      const panel = document.querySelector('.tab-panel.active');
      const app = document.getElementById('app').getBoundingClientRect();
      const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
      const navItem = document.querySelector('.bottom-nav .nav-item');
      return {
        horizontalOverflow: panel.scrollWidth - panel.clientWidth,
        appBottom: app.bottom,
        navTop: nav.top,
        navItemFits: navItem.scrollHeight <= navItem.clientHeight + 1
      };
    });
    expect(layout.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(layout.appBottom).toBeLessThanOrEqual(layout.navTop + 1);
    expect(layout.navItemFits).toBe(true);
  });
});
