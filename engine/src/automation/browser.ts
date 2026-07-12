import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import type { AIAction } from '../ai/client';

export class BrowserController {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async init(headless = false, viewport: { width: number; height: number } = { width: 1920, height: 1080 }) {
    const width = Number.isFinite(viewport.width) ? Math.max(320, Math.round(viewport.width)) : 1920;
    const height = Number.isFinite(viewport.height) ? Math.max(320, Math.round(viewport.height)) : 1080;
    this.browser = await chromium.launch({ 
      headless,
      args: [`--window-size=${width},${height}`]
    });
    const context = await this.browser.newContext({ viewport: { width, height }, screen: { width, height } });
    this.page = await context.newPage();

    // --- MANEJO AUTOMÁTICO DE DIÁLOGOS (Alerts, Prompts, Confirms) ---
    this.page.on('dialog', async dialog => {
        console.log(`💬 Dialog detected: [${dialog.type()}] ${dialog.message()}`);
        if (dialog.type() === 'prompt') {
            await dialog.accept('Respuesta de IA'); // Default response for prompts
        } else {
            await dialog.accept();
        }
    });
  }

  getPage() {
    if (!this.page) throw new Error('Browser not initialized');
    return this.page;
  }

  async executeAction(action: any): Promise<string> {
    if (!this.page) return 'Error: Browser not initialized';

    const elementId = action.elementId || action.selector;
    let technicalCommand = '';

    if (action.selector && !action.elementId) {
        console.warn(`⚠️ AI hallucinated 'selector' instead of 'elementId'. Using fallback.`);
    }

    console.log(`🚀 Executing: ${action.action} ${elementId || action.url || ''}`);

    switch (action.action) {
      case 'navigate':
        if (action.url) {
            technicalCommand = `page.goto('${action.url}')`;
            await this.page.goto(action.url, { waitUntil: 'networkidle' });
        }
        break;
      case 'click':
        if (elementId) {
          const selector = `[data-ai-id="${elementId}"]`;
          technicalCommand = `page.locator('${selector}').click()`;
          const locator = this.page.locator(selector);
          await locator.scrollIntoViewIfNeeded(); 
          await locator.waitFor({ state: 'visible', timeout: 5000 });
          await locator.click({ timeout: 5000 });
        }
        break;
      case 'double_click':
        if (elementId) {
          const selector = `[data-ai-id="${elementId}"]`;
          technicalCommand = `page.locator('${selector}').dblclick()`;
          const locator = this.page.locator(selector);
          await locator.scrollIntoViewIfNeeded();
          await locator.waitFor({ state: 'visible', timeout: 5000 });
          await locator.dblclick();
        }
        break;
      case 'right_click':
        if (elementId) {
          const selector = `[data-ai-id="${elementId}"]`;
          technicalCommand = `page.locator('${selector}').click({ button: 'right' })`;
          const locator = this.page.locator(selector);
          await locator.scrollIntoViewIfNeeded();
          await locator.click({ button: 'right' });
        }
        break;
      case 'hover':
        if (elementId) {
          const selector = `[data-ai-id="${elementId}"]`;
          technicalCommand = `page.locator('${selector}').hover()`;
          const locator = this.page.locator(selector);
          await locator.scrollIntoViewIfNeeded();
          await locator.hover();
        }
        break;
      case 'type':
        if (elementId && action.text !== undefined) {
          const selector = `[data-ai-id="${elementId}"]`;
          technicalCommand = `page.locator('${selector}').type('${action.text}')`;
          const locator = this.page.locator(selector);
          await locator.scrollIntoViewIfNeeded();
          await locator.waitFor({ state: 'visible', timeout: 5000 });
          
          console.log(`  > Typing "${action.text}" into ${elementId}`);
          
          const type = await locator.getAttribute('type');
          if (type !== 'range') {
              await locator.fill('');
          }
          
          await locator.click();
          await this.page.keyboard.type(action.text, { delay: 50 });
          
          await this.page.keyboard.press('Tab');
          await this.page.waitForTimeout(200); 
        }
        break;
      case 'drag_and_drop':
        if (action.elementId && action.targetId) {
          const sourceSel = `[data-ai-id="${action.elementId}"]`;
          const targetSel = `[data-ai-id="${action.targetId}"]`;
          technicalCommand = `page.locator('${sourceSel}').dragTo('${targetSel}')`;
          const source = this.page.locator(sourceSel);
          const target = this.page.locator(targetSel);
          await source.scrollIntoViewIfNeeded();
          await source.dragTo(target);
        }
        break;
      case 'upload':
        if (elementId) {
            const selector = `[data-ai-id="${elementId}"]`;
            technicalCommand = `page.locator('${selector}').setInputFiles(...)`;
            const locator = this.page.locator(selector);
            await locator.scrollIntoViewIfNeeded();
            
            // Create a dummy file for testing if it doesn't exist
            const fs = await import('fs');
            const path = await import('path');
            const filePath = path.resolve('test-upload.png');
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, 'fake image data');
            }
            
            console.log(`  > Uploading placeholder to ${elementId}`);
            await locator.setInputFiles(filePath);
        }
        break;
      case 'scroll':
        if (elementId && elementId !== 'body' && elementId !== 'window') {
          const selector = `[data-ai-id="${elementId}"]`;
          technicalCommand = `page.locator('${selector}').scrollIntoViewIfNeeded()`;
          const locator = this.page.locator(selector);
          try {
              await locator.scrollIntoViewIfNeeded({ timeout: 2000 });
          } catch (e) {
              console.warn(`⚠️ Scroll on ${elementId} failed, falling back to window scroll.`);
              const direction = action.text?.toLowerCase() === 'up' ? -500 : 500;
              await this.page.evaluate((d) => window.scrollBy(0, d), direction);
          }
        } else {
          const direction = action.text?.toLowerCase() === 'up' ? -500 : 500;
          technicalCommand = `window.scrollBy(0, ${direction})`;
          await this.page.evaluate((d) => window.scrollBy(0, d), direction);
        }
        break;
      case 'press_enter':
        technicalCommand = `page.keyboard.press('Enter')`;
        if (action.elementId) {
          const locator = this.page.locator(`[data-ai-id="${action.elementId}"]`);
          await locator.scrollIntoViewIfNeeded();
          await locator.focus();
        }
        console.log(`  > Pressing Enter on ${action.elementId || 'current focus'}`);
        await this.page.keyboard.press('Enter');
        break;
      case 'wait':
        technicalCommand = `page.waitForTimeout(2000)`;
        await this.page.waitForTimeout(2000);
        break;
      case 'finish':
        technicalCommand = `// Task finished`;
        console.log('✅ Task finished:', action.reason);
        break;
      default:
        technicalCommand = `// Unknown action: ${action.action}`;
        console.warn('Unknown action:', action.action);
    }

    // Small cooldown after any action to let DOM settle
    await this.page.waitForTimeout(300);
    return technicalCommand;
  }

  async close() {
    if (this.browser) await this.browser.close();
  }
}
