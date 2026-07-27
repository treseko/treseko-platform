import type { QAEngineStep, RuntimeStepValidationPlan, StepAssertion } from './action-types.ts';
import { buildStepContract, parseStepData } from './step-contract.ts';
import { interpretStepData, valueForRole } from './context-data-interpreter.ts';

function normalize(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function assertion(type: StepAssertion['type'], source: string, target?: string, expected?: StepAssertion['expected']): Omit<StepAssertion, 'id'> {
  return { type, source, ...(target ? { target } : {}), ...(expected !== undefined ? { expected } : {}) };
}

/**
 * Produces a run-scoped validation plan from the three legacy test-case fields.
 * The plan deliberately lives only in memory so exported/imported test cases
 * remain compatible with the existing Action, Data and Expected result format.
 */
export function planExecutionValidation(steps: QAEngineStep[]): QAEngineStep[] {
  return steps.map((step) => ({ ...step, validation_plan: planStep(step) }));
}

export function planStep(step: QAEngineStep): RuntimeStepValidationPlan {
  const expected = String(step.expected || '').trim();
  const text = normalize(`${step.action || ''} ${step.data || ''} ${expected}`);
  const expectedText = normalize(expected);
  const action = normalize(step.action);
  const data = String(step.data || '').trim();
  const structuredData = parseStepData(data);
  const resolvedData = interpretStepData(data);
  const assertions: Omit<StepAssertion, 'id'>[] = [];

  // A form described by its controls is a UI-state assertion, not a literal
  // sentence that must appear in the page body.
  const mentionsLoginForm = /(formulario|pantalla|pagina).*(acceso|inicio de sesion|login)|(?:acceso|inicio de sesion|login).*(formulario|pantalla|pagina)/.test(text);
  const mentionsUsername = /\b(username|usuario|user|correo|email)\b/.test(text);
  const mentionsPassword = /\b(password|contrasena|contraseña|clave)\b/.test(text);
  if (mentionsLoginForm && (mentionsUsername || mentionsPassword)) {
    if (mentionsUsername) assertions.push(assertion('element_visible', expected, 'username'));
    if (mentionsPassword) assertions.push(assertion('element_visible', expected, 'password'));
    if (/\b(boton|button).*(login|iniciar sesion)|(?:login|iniciar sesion).*(boton|button)/.test(text)) {
      assertions.push(assertion(/habilitad/.test(text) ? 'button_enabled' : 'element_visible', expected, 'login'));
    }
  }

  // Values entered in inputs are not part of the page's visible text. Treat
  // them as element state, using the action/data as the source of truth.
  // A generic error sentence can name Username or Password (for example
  // "Username and password do not match") without asserting either input's
  // value. Only treat this as a field-value assertion when it explicitly
  // refers to the field/control itself.
  const expectsFieldValue = /(?:campo|input|control)\s+(?:username|usuario|user|correo|email|password|contrasena|contraseña|clave).*?(?:muestra|queda|conserva|contiene|completad)|(?:username|usuario|user|correo|email|password|contrasena|contraseña|clave)\s+(?:muestra|queda|conserva|contiene|completad)/.test(text);
  const mentionsUsernameField = /\b(username|usuario|user|correo|email)\b/.test(text);
  const mentionsPasswordField = /\b(password|contrasena|contraseña|clave)\b/.test(text);
  const writesValue = /(escribir|ingresar|completar|introducir|cargar|type)/.test(action)
    && !/sin completar/.test(action);
  const compactCredentialData = data.split('/').map((value) => value.trim()).filter(Boolean).length === 2;
  if (assertions.length === 0 && data && (expectsFieldValue || writesValue) && !compactCredentialData) {
    if (mentionsUsernameField) {
      const value = valueForRole(resolvedData, ['username', 'email']) ?? structuredData.username ?? structuredData.usuario ?? structuredData.user ?? structuredData.email ?? structuredData.login ?? data;
      assertions.push(assertion('element_value', expected, 'username', value));
    } else if (mentionsPasswordField) {
      const value = valueForRole(resolvedData, ['password']) ?? structuredData.password ?? structuredData.contrasena ?? structuredData['contraseña'] ?? structuredData.pass ?? data;
      assertions.push(assertion('element_value', expected, 'password', value));
    }
  }

  const checkoutValues = data.split('/').map((value) => value.trim()).filter(Boolean);
  const compactCredentials = data.split('/').map((value) => value.trim()).filter(Boolean);
  const fillsCompactCredentials = /(ingresar|escribir|introducir|completar)/.test(action)
    && compactCredentials.length === 2
    && /(?:usuario|username|user).*(?:clave|password|contrasena)|(?:clave|password|contrasena).*(?:usuario|username|user)/.test(text);
  if (assertions.length === 0 && fillsCompactCredentials) {
    assertions.push(assertion('element_value', expected, 'username', compactCredentials[0]));
    assertions.push(assertion('element_value', expected, 'password', compactCredentials[1]));
  }
  const refersToThreeCheckoutFields = /(tres campos|first name|last name|postal code|codigo postal)/.test(text);
  if (assertions.length === 0 && checkoutValues.length >= 3 && refersToThreeCheckoutFields) {
    assertions.push(assertion('element_value', expected, 'first name', checkoutValues[0]));
    assertions.push(assertion('element_value', expected, 'last name', checkoutValues[1]));
    assertions.push(assertion('element_value', expected, 'postal code', checkoutValues[2]));
  }

  // Login errors name the credentials in their message but are not assertions
  // about the current values of either input. Normalize the visible error
  // family so it remains a deterministic DOM check.
  if (assertions.length === 0 && /(epic sadface|locked out|do not match|username is required)/.test(expectedText)) {
    assertions.push({
      type: 'text_contains_any',
      source: expected,
      alternatives: [
        'epic sadface',
        'username and password do not match',
        'sorry, this user has been locked out',
        'username is required',
      ],
    });
  }

  if (assertions.length === 0 && /(mensaje|alerta).*error.*(?:deja de estar visible|desaparece|no.*visible)/.test(expectedText)) {
    // Invalid fields can retain an "error" CSS class after the alert is
    // closed. The close control is the specific, user-visible evidence that
    // the error message itself disappeared.
    assertions.push({ ...assertion('element_count', expected, 'error-button', 0), comparator: 'equals' });
  }

  // Side menus and logout transitions are observable controls and URL/form
  // state. Do not send these conventional checks to a semantic auditor.
  if (assertions.length === 0 && /(?:opcion|boton|enlace).*(?:logout|cerrar sesion).*(?:visible|muestra)|(?:logout|cerrar sesion).*(?:visible|muestra)/.test(expectedText)) {
    assertions.push(assertion('element_visible', expected, 'logout'));
  }
  const returnsToLogin = /(?:url|direccion).*(?:vuelve|regresa|retorna).*?(?:\binicio\b|\blogin\b|\ba\s+\/\s*(?:[.!]|$))/.test(expectedText);
  if (assertions.length === 0 && (returnsToLogin || /username.*visible/.test(expectedText))) {
    assertions.push(assertion('element_visible', expected, 'username'));
    if (returnsToLogin) {
      assertions.push(assertion('url_matches', expected, undefined, '/'));
    }
  }

  const urlTarget = expected.match(/\/(?:[\w.-]+\/)*[\w.-]+(?:\?[\w=&.-]+)?/);
  if (assertions.length === 0 && urlTarget && /\burl\b/.test(text)) {
    assertions.push(assertion(
      /\bno\s+(?:termina|incluye|contiene)|no termina/.test(text) ? 'url_not_matches' : 'url_matches',
      expected,
      undefined,
      urlTarget[0].replace(/[.,;:]+$/g, ''),
    ));
  }

  if (assertions.length === 0 && /(?:abrir|detalle).*(?:producto|sauce)|(?:producto|sauce).*detalle/.test(text) && /(?:visualiza|muestra).*detalle/.test(expectedText)) {
    assertions.push(assertion('url_matches', expected, undefined, 'inventory-item.html'));
  }

  // Sorting cases commonly describe the first visible product in prose. The
  // product name and its price remain deterministic DOM evidence even though
  // the imported case does not expose a separate assertion type for ordering.
  const firstProduct = expected.match(/primer producto visible es\s+(.+?)\s+con precio\s+(\$?\d+(?:[.,]\d{2})?)/i);
  if (assertions.length === 0 && firstProduct?.[1] && firstProduct[2]) {
    assertions.push(assertion('text_contains', expected, undefined, firstProduct[1].trim()));
    assertions.push(assertion('text_contains', expected, undefined, firstProduct[2].replace(',', '.')));
  }

  // The browser observation preserves DOM order. The first inventory card is
  // therefore deterministic evidence for conventional sorting cases even
  // when the imported expectation omits the price.
  const firstVisibleProduct = expected.match(/primer producto visible es\s+(.+?)[.!]?(?:\s*)$/i);
  if (assertions.length === 0 && firstVisibleProduct?.[1]) {
    assertions.push(assertion('element_contains', expected, 'inventory_item', firstVisibleProduct[1].trim()));
  }

  const visibleNameAndPrice = expected.match(/se muestran\s+(.+?)\s+y\s+(\$\d+(?:[.,]\d{2})?)/i);
  if (assertions.length === 0 && visibleNameAndPrice?.[1] && visibleNameAndPrice[2]) {
    assertions.push(assertion('text_contains', expected, undefined, visibleNameAndPrice[1].trim()));
    assertions.push(assertion('text_contains', expected, undefined, visibleNameAndPrice[2].replace(',', '.')));
  }

  // A result that names two visible entities is still deterministic evidence.
  // It commonly appears after opening a list, cart, or detail view.
  const visiblePair = expected.match(/(?:se\s+)?visualizan\s+(.+?)\s+y\s+(.+?)[.!]?$/i);
  if (assertions.length === 0 && visiblePair?.[1] && visiblePair[2]) {
    assertions.push(assertion('text_contains', expected, undefined, visiblePair[1].trim()));
    assertions.push(assertion('text_contains', expected, undefined, visiblePair[2].trim()));
  }

  const exactPrice = expected.match(/(?:muestra|precio).*?(\$\d+(?:[.,]\d{2})?)/i);
  if (assertions.length === 0 && exactPrice?.[1]) {
    // The numeric price is the stable evidence. Some applications render the
    // currency symbol outside the text node exposed by the browser.
    assertions.push(assertion('text_contains', expected, undefined, exactPrice[1].replace('$', '').replace(',', '.')));
  }

  const productCount = expected.match(/\b(\d+)\s+(?:tarjetas?|productos?)\s+de\s+producto/i);
  if (assertions.length === 0 && productCount?.[1]) {
    assertions.push({ ...assertion('element_count', expected, 'inventory_item', Number(productCount[1])), comparator: 'equals' });
  }

  // Cart transitions are expressed as natural language in legacy cases, but
  // their evidence is regular DOM state: button label plus the badge value.
  // Keep this as execution-time interpretation, not a new test-case field.
  const expectsRemove = /boton.*(?:cambia|muestra|queda).*\bremove\b|\bremove\b.*(?:visible|muestra)/.test(expectedText);
  const expectsAddToCart = /boton.*(?:vuelve|cambia|muestra|queda).*add to cart|add to cart.*(?:visible|muestra)/.test(expectedText);
  const badgeCount = expected.match(/badge.*?(?:muestra|indica|tiene|con)\s*(\d+)/i);
  const badgeDisappears = /badge.*(?:desaparece|no aparece|no se muestra|oculta)/.test(expectedText);
  if (assertions.length === 0 && (expectsRemove || expectsAddToCart || badgeCount || badgeDisappears)) {
    if (expectsRemove) assertions.push(assertion('element_visible', expected, 'remove'));
    if (expectsAddToCart) assertions.push(assertion('element_visible', expected, 'add to cart'));
    if (badgeCount?.[1]) assertions.push(assertion('element_contains', expected, 'badge', badgeCount[1]));
    if (badgeDisappears) assertions.push({ ...assertion('element_count', expected, 'badge', 0), comparator: 'equals' });
  }

  // An empty cart/list is observable from the absence of its per-item action.
  // This avoids treating a simple empty-state outcome as a visual judgement.
  if (assertions.length === 0 && /no\s+se\s+muestran\s+productos.*(?:carrito|lista)|(?:carrito|lista).*sin\s+productos/.test(expectedText)) {
    assertions.push({ ...assertion('element_count', expected, 'remove', 0), comparator: 'equals' });
  }

  // Prefer the existing deterministic parser whenever it already understands
  // the expected result. This avoids changing established API/assertion cases.
  const legacy = buildStepContract({ ...step, validation_plan: undefined });
  if (assertions.length === 0 && legacy.coverage === 'full' && legacy.assertions.length > 0) {
    return {
      mode: 'dom',
      assertions: legacy.assertions.map(({ id: _id, ...item }) => item),
      reason: 'El analista reutilizo aserciones estructuradas verificables.',
      confidence: 98,
      source: 'rules',
    };
  }
  if (assertions.length > 0) {
    return {
      mode: 'dom',
      assertions,
      reason: 'El resultado esperado describe controles visibles; se validan los controles, no la redaccion literal.',
      confidence: 96,
      source: 'rules',
    };
  }

  // Ambiguous natural language must not be silently downgraded to a brittle
  // text comparison. It is marked for semantic/visual audit when available.
  return {
    mode: 'visual_semantic',
    assertions: [],
    reason: expected
      ? 'El resultado esperado requiere interpretacion semantica o visual durante la auditoria.'
      : 'El paso no define un resultado esperado verificable.',
    confidence: expected ? 70 : 100,
    source: 'rules',
  };
}
