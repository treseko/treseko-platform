import type { Page } from 'playwright';

export interface ElementInfo {
  id: string; // AI internal ID (el-0, el-1...)
  htmlId?: string; // Real HTML ID attribute
  name?: string; // Real HTML name attribute
  tagName: string;
  text: string;
  value?: string;
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
  title?: string;
  role?: string;
  context?: string; // Additional context like "Table Row 2"
}

export async function getInteractiveElements(page: Page): Promise<ElementInfo[]> {
  return await page.evaluate(() => {
    // Clear existing data-ai-id attributes to avoid collisions between steps
    document.querySelectorAll('[data-ai-id]').forEach(el => el.removeAttribute('data-ai-id'));

    // Select interactive elements
    const interactiveSelector = 'button, input, select, textarea, a, [role="button"], [onclick], .btn, span[title], span[id*="delete"], span[id*="edit"], .rct-collapse, [title*="Toggle"], [title*="Expand"]';
    // Select informational text elements that might contain credentials, instructions or table data
    const infoSelector = 'p, span, div, label, h1, h2, h3, h4, h5, h6, li, td, [role="gridcell"], .rt-td';
    
    const interactives = Array.from(document.querySelectorAll(interactiveSelector));
    const informational = Array.from(document.querySelectorAll(infoSelector)).filter(el => {
        const htmlEl = el as HTMLElement;
        const text = (htmlEl.innerText || '').trim();
        if (!text || text.length > 200) return false;
        
        // Avoid capturing containers that only contain other info elements
        const hasInteractiveChild = el.querySelector(interactiveSelector);
        if (hasInteractiveChild) return false;

        // Ensure we are getting the "deepest" text container possible
        const hasInfoChild = Array.from(el.children).some(child => child.matches(infoSelector) && (child as HTMLElement).innerText.trim().length > 0);
        if (hasInfoChild && el.tagName !== 'TD' && !el.classList.contains('rt-td')) return false;

        return true;
    });

    const allElements = [...interactives, ...informational];
    const seen = new Set();
    
    return allElements
      .filter(el => {
        if (seen.has(el)) return false;
        seen.add(el);

        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const isVisible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
        
        // For informational elements, they don't need to be "clickable"
        const isInteractive = el.matches(interactiveSelector) || style.cursor === 'pointer' || el.tagName === 'BUTTON' || el.tagName === 'A' || el.hasAttribute('onclick');
        
        return isVisible && (isInteractive || informational.includes(el));
      })
      .map((el, index) => {
        const htmlEl = el as HTMLElement;
        const inputEl = el as HTMLInputElement;
        
        const id = `el-${index}`;
        htmlEl.setAttribute('data-ai-id', id);

        // --- HEURÍSTICA DE ETIQUETADO ---
        let inferredLabel = htmlEl.ariaLabel || htmlEl.getAttribute('aria-label') || htmlEl.title || undefined;
        
        // Detectar si es un botón de expandir/colapsar (árboles) con mayor agresividad
        const className = htmlEl.className || '';
        const tagName = el.tagName;
        const innerHTML = htmlEl.innerHTML || '';
        const isToggle = (typeof className === 'string' && (className.includes('rct-collapse') || className.includes('toggle') || className.includes('expand'))) || 
                         (innerHTML.includes('rct-icon-expand-close') || innerHTML.includes('rct-icon-expand-all'));
        
        if (isToggle) inferredLabel = "BOTÓN_EXPANDIR_ARBOL (Click para ver sub-elementos)";

        if (!inferredLabel && (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT')) {
            // 1. Buscar etiqueta <label> vinculada por ID
            if (htmlEl.id) {
                const label = document.querySelector(`label[for="${htmlEl.id}"]`);
                if (label) inferredLabel = (label as HTMLElement).innerText;
            }
            
            // 2. Buscar texto cercano (hacia arriba o a la izquierda)
            if (!inferredLabel) {
                // Buscar label padre
                const parentLabel = htmlEl.closest('label');
                if (parentLabel) inferredLabel = parentLabel.innerText;
                
                // Buscar elemento de texto anterior en el DOM
                if (!inferredLabel) {
                    const prevSibling = htmlEl.previousElementSibling;
                    if (prevSibling && (prevSibling.tagName === 'LABEL' || prevSibling.tagName === 'SPAN' || prevSibling.tagName === 'P')) {
                        inferredLabel = (prevSibling as HTMLElement).innerText;
                    }
                }
            }
        }

        // Try to find table context
        let context = '';
        const row = htmlEl.closest('tr') || htmlEl.closest('[role="row"]');
        if (row) {
            context = `Table Row ${row.rowIndex}`;
        } else if (htmlEl.closest('.rt-tr')) { // Support for some react tables like DemoQA
            const rtRow = htmlEl.closest('.rt-tr-group');
            if (rtRow) {
                const rows = Array.from(document.querySelectorAll('.rt-tr-group'));
                context = `Grid Row ${rows.indexOf(rtRow) + 1}`;
            }
        }

        const isInteractive = el.matches(interactiveSelector) || window.getComputedStyle(el).cursor === 'pointer' || el.tagName === 'BUTTON' || el.tagName === 'A' || el.hasAttribute('onclick');

        return {
          id,
          htmlId: htmlEl.id || undefined,
          name: htmlEl.getAttribute('name') || undefined,
          tagName: el.tagName.toLowerCase(),
          text: (htmlEl.innerText || '').trim().substring(0, 200), // Limit text length
          value: inputEl.value || undefined,
          type: inputEl.type || undefined,
          placeholder: inputEl.placeholder || undefined,
          ariaLabel: inferredLabel || htmlEl.ariaLabel || htmlEl.getAttribute('aria-label') || undefined,
          title: htmlEl.title || undefined,
          role: htmlEl.getAttribute('role') || (isInteractive ? undefined : 'text'), // Mark non-interactives as text
          context: context || undefined
        };
      });
  });
}

export function formatState(elements: ElementInfo[]): string {
  return elements
    .map(el => {
      let desc = `ID: ${el.id} | Tag: ${el.tagName}`;
      if (el.htmlId) desc += ` | htmlId: "${el.htmlId}"`;
      if (el.name) desc += ` | htmlName: "${el.name}"`;
      if (el.context) desc += ` | Location: ${el.context}`;
      if (el.text) desc += ` | Text: "${el.text}"`;
      if (el.title) desc += ` | Title: "${el.title}"`;
      if (el.ariaLabel) desc += ` | Label: "${el.ariaLabel}"`;
      if (el.value) desc += ` | Value: "${el.value}"`;
      if (el.placeholder) desc += ` | Placeholder: "${el.placeholder}"`;
      if (el.type) desc += ` | type: "${el.type}"`;
      return desc;
    })
    .join('\n');
}
