import type { Page } from 'playwright';
import type { BrowserObservation } from './action-types.ts';
import { traceEntry, traceRequestId } from '../test-trace.ts';

const ELEMENT_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  '[role]',
  '[onclick]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
  'summary',
].join(',');

export async function observeBrowser(page: Page, executionId?: string, stepNumber?: number): Promise<BrowserObservation> {
  await page.evaluate('globalThis.__name = globalThis.__name || ((fn) => fn)').catch(() => undefined);
  const observation = await page.evaluate((selector) => {
    document.querySelectorAll('[data-ai-ref]').forEach((el) => el.removeAttribute('data-ai-ref'));

    const compact = (value: string | null | undefined, max = 180) => {
      const text = (value || '').replace(/\s+/g, ' ').trim();
      return text.length > max ? `${text.slice(0, max)}...` : text;
    };

    const labelFor = (el: Element) => {
      const htmlEl = el as HTMLElement;
      const aria = htmlEl.getAttribute('aria-label') || htmlEl.getAttribute('title');
      if (aria) return compact(aria);
      const id = htmlEl.getAttribute('id');
      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label) return compact((label as HTMLElement).innerText);
      }
      const parentLabel = htmlEl.closest('label');
      if (parentLabel) return compact((parentLabel as HTMLElement).innerText);
      const prev = htmlEl.previousElementSibling as HTMLElement | null;
      if (prev && ['LABEL', 'SPAN', 'P', 'DIV'].includes(prev.tagName)) return compact(prev.innerText, 80);
      return undefined;
    };

    const isVisible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    };

    const isEditable = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable;
    };

    const isClickable = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      const style = window.getComputedStyle(el);
      return ['a', 'button', 'summary'].includes(tag) || ['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'option'].includes(role) || !!el.getAttribute('onclick') || style.cursor === 'pointer';
    };

    const elements = Array.from(document.querySelectorAll(selector))
      .filter((el) => isVisible(el))
      .slice(0, 140)
      .map((el, index) => {
        const htmlEl = el as HTMLElement;
        const inputEl = el as HTMLInputElement;
        const rect = el.getBoundingClientRect();
        const ref = `el-${index}`;
        htmlEl.setAttribute('data-ai-ref', ref);
        htmlEl.setAttribute('data-ai-id', ref);
        const text = compact(htmlEl.innerText || inputEl.value || htmlEl.textContent, 220);
        const role = htmlEl.getAttribute('role') || undefined;
        const label = labelFor(el);
        return {
          ref,
          tag: el.tagName.toLowerCase(),
          role,
          name: compact(htmlEl.getAttribute('name') || htmlEl.getAttribute('id') || undefined, 80),
          text,
          value: compact(inputEl.value, 120) || undefined,
          type: inputEl.type || undefined,
          placeholder: compact(inputEl.placeholder, 120) || undefined,
          label,
          title: compact(htmlEl.getAttribute('title'), 120) || undefined,
          disabled: Boolean((inputEl as any).disabled || htmlEl.getAttribute('aria-disabled') === 'true'),
          visible: true,
          editable: isEditable(el),
          clickable: isClickable(el),
          bbox: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      });

    const visibleText = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,label,li,td,th,[role="alert"],[role="status"]'))
      .map((el) => compact((el as HTMLElement).innerText, 180))
      .filter(Boolean)
      .slice(0, 60);

    const loadingSignals = Array.from(document.querySelectorAll('[aria-busy="true"],[role="progressbar"],.spinner,.loading,.skeleton'))
      .filter((el) => isVisible(el))
      .map((el) => compact((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.className?.toString(), 120))
      .slice(0, 20);

    const forms = Array.from(document.querySelectorAll('form')).slice(0, 20).map((form, index) => ({
      ref: `form-${index}`,
      fields: Array.from(form.querySelectorAll('input,select,textarea')).map((field) => labelFor(field) || (field as HTMLInputElement).name || (field as HTMLInputElement).placeholder || field.tagName.toLowerCase()).filter(Boolean).slice(0, 20),
    }));

    return {
      url: window.location.href,
      title: document.title,
      readyState: document.readyState,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      loadingSignals,
      dialogs: [],
      visibleText,
      elements,
      forms,
    };
  }, ELEMENT_SELECTOR);

  traceEntry('browser_observation', {
    request_id: traceRequestId('engine-observation'),
    execution_id: executionId,
    step_number: stepNumber,
    body: observation,
  });

  return observation;
}

export function formatObservation(observation: BrowserObservation): string {
  const elements = observation.elements.map((el) => {
    const parts = [
      `${el.ref}`,
      el.role ? `role=${el.role}` : `tag=${el.tag}`,
      el.name ? `name="${el.name}"` : '',
      el.label ? `label="${el.label}"` : '',
      el.text ? `text="${el.text}"` : '',
      el.placeholder ? `placeholder="${el.placeholder}"` : '',
      el.value ? `value="${el.value}"` : '',
      el.type ? `type=${el.type}` : '',
      el.disabled ? 'disabled' : '',
      el.editable ? 'editable' : '',
      el.clickable ? 'clickable' : '',
      el.bbox ? `box=${el.bbox.x},${el.bbox.y},${el.bbox.width},${el.bbox.height}` : '',
    ].filter(Boolean);
    return `- ${parts.join(' | ')}`;
  }).join('\n');

  const forms = observation.forms.map((form) => `- ${form.ref}: ${form.fields.join(', ')}`).join('\n');
  const text = observation.visibleText.map((item) => `- ${item}`).join('\n');
  const loading = observation.loadingSignals.length ? observation.loadingSignals.map((item) => `- ${item}`).join('\n') : '- none';

  return [
    `URL: ${observation.url}`,
    `Title: ${observation.title}`,
    `ReadyState: ${observation.readyState}`,
    `Loading signals:\n${loading}`,
    `Forms:\n${forms || '- none'}`,
    `Visible text:\n${text || '- none'}`,
    `Actionable elements:\n${elements || '- none'}`,
  ].join('\n\n');
}
