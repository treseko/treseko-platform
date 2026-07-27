import type {
  BrowserElementSnapshot,
  BrowserObservation,
  QAEngineStep,
  StepAssertion,
  StepAssertionResult,
  StepContract,
  StrictAIAction,
} from './action-types.ts';

export type StepDataMap = Record<string, string>;

function normalizeText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parses legacy key=value step data without letting one value consume the next
 * key. Values may contain spaces and can be separated by whitespace, commas,
 * semicolons or new lines.
 */
export function parseStepData(value: unknown): StepDataMap {
  const text = String(value || '').trim();
  if (!text) return {};
  const result: StepDataMap = {};
  const keyPattern = /\b([a-zA-Z_][\w.-]*)\s*[:=]\s*/g;
  const matches = Array.from(text.matchAll(keyPattern));
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (!match) continue;
    const key = String(match[1] || '').toLowerCase();
    const valueStart = Number(match.index || 0) + match[0].length;
    const nextStart = index + 1 < matches.length ? Number(matches[index + 1]?.index ?? text.length) : text.length;
    const rawValue = text.slice(valueStart, nextStart).replace(/[\s,;]+$/g, '');
    result[key] = unquote(rawValue);
  }
  return result;
}

export function stepDataValue(step: QAEngineStep, keys: string[]): string {
  const values = parseStepData(`${step.data || ''}\n${step.action || ''}`);
  for (const key of keys) {
    const normalized = key.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(values, normalized)) return values[normalized] ?? '';
  }
  return '';
}

export function hasStepDataKey(step: QAEngineStep, keys: string[]): boolean {
  const values = parseStepData(`${step.data || ''}\n${step.action || ''}`);
  return keys.some((key) => Object.prototype.hasOwnProperty.call(values, key.toLowerCase()));
}

function elementCorpus(element: BrowserElementSnapshot): string {
  return normalizeText([
    element.name,
    element.label,
    element.text,
    element.placeholder,
    element.title,
    element.role,
    element.type,
  ].filter(Boolean).join(' '));
}

export function findElement(
  observation: BrowserObservation,
  terms: string[],
  predicate: (element: BrowserElementSnapshot) => boolean,
): BrowserElementSnapshot | undefined {
  const normalizedTerms = terms.map(normalizeText).filter(Boolean);
  return observation.elements.find((element) => (
    element.visible
    && predicate(element)
    && normalizedTerms.some((term) => elementCorpus(element).includes(term))
  ));
}

export function inferStructuredAction(step: QAEngineStep, observation: BrowserObservation): StrictAIAction | null {
  const data = parseStepData(step.data);
  const text = normalizeText(`${step.action || ''} ${step.expected || ''}`);
  const explicitlySubmits = /\b(enviar|submit|iniciar sesion|confirmar envio)\b/.test(normalizeText(step.action || ''));
  const expected = step.expected ? { expected: step.expected } : {};
  const base = { confidence: 100, step_number: step.number, ...expected };

  const username = data.username ?? data.usuario ?? data.user ?? data.email ?? data.login;
  const password = data.password ?? data['contraseña'] ?? data.contrasena ?? data.pass;
  if (username !== undefined && password !== undefined) {
    const usernameField = findElement(observation, ['username', 'usuario', 'email', 'login', 'user'], (element) => element.editable && element.type !== 'password');
    const passwordField = findElement(observation, ['password', 'contrasena', 'contraseña'], (element) => element.editable && element.type === 'password');
    if (usernameField && passwordField) {
      return {
        action: 'fill_form',
        fields: [
          { target_ref: usernameField.ref, value: username },
          { target_ref: passwordField.ref, value: password },
        ],
        submit_after_type: explicitlySubmits,
        reason: explicitlySubmits
          ? 'Completar las credenciales estructuradas y enviar porque el paso lo solicita explicitamente.'
          : 'Completar las credenciales estructuradas sin enviar el formulario.',
        ...base,
      };
    }
  }

  // Structured credentials are also commonly supplied as separate legacy
  // steps (for example, `username=standard_user` followed by `password=...`).
  // They are unambiguous, so resolve them before delegating to the model even
  // when the optional conventional-workflow policy is disabled.
  if (username !== undefined) {
    const usernameField = findElement(observation, ['username', 'usuario', 'email', 'login', 'user'], (element) => element.editable && element.type !== 'password');
    if (usernameField) {
      return {
        action: 'type',
        target_ref: usernameField.ref,
        value: username,
        submit_after_type: false,
        reason: 'Completar el usuario estructurado sin enviar el formulario.',
        ...base,
      };
    }
  }
  if (password !== undefined) {
    const passwordField = findElement(observation, ['password', 'contrasena', 'contraseña'], (element) => element.editable && element.type === 'password');
    if (passwordField) {
      return {
        action: 'type',
        target_ref: passwordField.ref,
        value: password,
        submit_after_type: false,
        reason: 'Completar la contrasena estructurada sin enviar el formulario.',
        ...base,
      };
    }
  }

  // A login submission without input data is equally explicit when the
  // instruction names the visible Login control. Resolve it locally so a
  // provider cannot return an unaddressable `click` action.
  if (/(presionar|pulsar|hacer clic|clic|click|enviar).*(?:boton |button )?login|(?:boton |button )?login.*(?:presionar|pulsar|hacer clic|clic|click|enviar)/.test(text)) {
    const loginButton = findElement(observation, ['login', 'iniciar sesion'], (element) => element.clickable && !element.disabled);
    if (loginButton) {
      return {
        action: 'click',
        target_ref: loginButton.ref,
        reason: 'Activar el boton Login visible indicado por el paso.',
        ...base,
      };
    }
  }

  const formFields: Array<{ target_ref: string; value: string }> = [];
  const titleKey = Object.prototype.hasOwnProperty.call(data, 'title') || Object.prototype.hasOwnProperty.call(data, 'titulo');
  const title = data.title ?? data.titulo ?? '';
  const severity = data.severity ?? data.severidad;
  const confirmed = data.confirmed ?? data.confirmado;
  if (titleKey && title) {
    const field = findElement(observation, ['title', 'titulo'], (element) => element.editable && element.tag !== 'select');
    if (field) formFields.push({ target_ref: field.ref, value: title });
  }
  if (severity !== undefined) {
    const field = findElement(observation, ['severity', 'severidad'], (element) => element.tag === 'select');
    if (field) formFields.push({ target_ref: field.ref, value: severity });
  }
  if (confirmed !== undefined) {
    const field = findElement(observation, ['confirmed', 'confirmar', 'confirmado'], (element) => element.type === 'checkbox');
    if (field) formFields.push({ target_ref: field.ref, value: confirmed });
  }
  if (formFields.length) {
    return {
      action: 'fill_form',
      fields: formFields,
      submit_after_type: explicitlySubmits,
      reason: explicitlySubmits
        ? 'Completar los controles y enviar porque el paso lo solicita explicitamente.'
        : 'Completar los controles del formulario sin enviarlo.',
      ...base,
    };
  }
  if (titleKey && title === '' && /(enviar|crear|submit|sin completar)/.test(text)) {
    const submit = findElement(observation, ['crear incidencia', 'enviar', 'submit', 'crear'], (element) => element.clickable && element.tag === 'button');
    if (submit) return { action: 'click', target_ref: submit.ref, reason: 'Enviar el formulario sin completar el campo requerido.', ...base };
  }

  const filter = data.filter ?? data.filtro;
  const search = data.search_term ?? data.termino ?? data.query ?? data.busqueda;
  const inputValue = filter ?? search;
  if (inputValue !== undefined) {
    const input = findElement(
      observation,
      filter !== undefined ? ['filter', 'filtrar'] : ['search', 'buscar'],
      (element) => element.editable && element.tag !== 'select',
    ) || observation.elements.find((element) => element.visible && element.editable && element.tag !== 'select');
    if (input) {
      return {
        action: 'type',
        target_ref: input.ref,
        value: inputValue,
        submit_after_type: false,
        reason: filter !== undefined ? 'Aplicar el filtro estructurado del caso.' : 'Ingresar el termino de busqueda estructurado del caso.',
        ...base,
      };
    }
  }

  if (confirmed !== undefined) {
    const checkbox = findElement(observation, ['confirmed', 'confirmar', 'confirmado'], (element) => element.type === 'checkbox');
    if (checkbox) return { action: 'check', target_ref: checkbox.ref, reason: 'Activar el control de confirmacion indicado por el caso.', ...base };
  }

  const actionHint = data.action;
  if (actionHint === 'open_modal' || /(pulsar|abrir el detalle|cargar resultado)/.test(text)) {
    const terms = actionHint === 'open_modal' || /detalle/.test(text) ? ['abrir detalle'] : ['cargar resultado'];
    const button = findElement(observation, terms, (element) => element.clickable && !element.disabled);
    if (button) return { action: 'click', target_ref: button.ref, reason: `Ejecutar la accion visible "${terms[0]}".`, ...base };
  }

  return null;
}

/**
 * Resolves the conventional action/data/expected fields without changing the
 * test-case format. It is opt-in per workflow because it is a policy choice,
 * not a replacement for the model on exploratory cases.
 */
export function inferConventionalUiAction(step: QAEngineStep, observation: BrowserObservation): StrictAIAction | null {
  const actionText = normalizeText(step.action);
  const rawData = String(step.data || '').trim();
  const expected = step.expected ? { expected: step.expected } : {};
  const base = { confidence: 99, step_number: step.number, ...expected };
  // "Sin completar" describes an intentionally empty form submission; it
  // must never be mistaken for a request to type into a field.
  const isTyping = /(escribir|ingresar|introducir|completar|tipear)/.test(actionText)
    && !/sin completar/.test(actionText);

  const visibleControl = (terms: string[], controlOnly = false): BrowserElementSnapshot | undefined => observation.elements.find((element) => {
    if (!element.visible || element.disabled || !element.clickable) return false;
    if (controlOnly && element.tag !== 'button' && !['button', 'menuitem'].includes(String(element.role || '').toLowerCase())) return false;
    const corpus = elementCorpus(element);
    return terms.some((term) => corpus.includes(normalizeText(term)));
  });

  const currentUrl = normalizeText(observation.url);
  const hasCheckoutData = rawData.split('/').map((value) => value.trim()).filter(Boolean).length >= 3;

  // A legacy case may express a complete purchase in one step. Advance one
  // visible state at a time so each retry is deterministic and inspectable.
  if (/completar.*(?:checkout|datos)|finalizar (?:la )?compra/.test(actionText) && hasCheckoutData) {
    if (/cart\.html/.test(currentUrl)) {
      const checkout = visibleControl(['checkout'], true);
      if (checkout) return { action: 'click', target_ref: checkout.ref, reason: 'Estrategia determinista del workflow: abrir Checkout desde el carrito.', ...base };
    }
    if (/checkout-step-one\.html/.test(currentUrl)) {
      const values = rawData.split('/').map((value) => value.trim());
      const firstName = findElement(observation, ['first name', 'first_name'], (element) => element.editable && element.type !== 'password');
      const lastName = findElement(observation, ['last name', 'last_name'], (element) => element.editable && element.type !== 'password');
      const postalCode = findElement(observation, ['postal code', 'postal_code', 'zip'], (element) => element.editable && element.type !== 'password');
      if (firstName && lastName && postalCode) {
        const fields = [
          { target_ref: firstName.ref, value: values[0] || '' },
          { target_ref: lastName.ref, value: values[1] || '' },
          { target_ref: postalCode.ref, value: values[2] || '' },
        ];
        const alreadyFilled = fields.every((field) => observation.elements.find((element) => element.ref === field.target_ref)?.value === field.value);
        if (!alreadyFilled) return { action: 'fill_form', fields, submit_after_type: /(?:hacer clic en )?continue|continuar/.test(actionText), reason: 'Estrategia determinista del workflow: completar los datos de Checkout.', ...base };
        const continueButton = visibleControl(['continue'], true);
        if (continueButton) return { action: 'click', target_ref: continueButton.ref, reason: 'Estrategia determinista del workflow: continuar al resumen de compra.', ...base };
      }
    }
    if (/checkout-step-two\.html/.test(currentUrl)) {
      const finish = visibleControl(['finish'], true);
      if (finish) return { action: 'click', target_ref: finish.ref, reason: 'Estrategia determinista del workflow: finalizar la compra desde el resumen.', ...base };
    }
  }

  if (/(?:reemplazar|cambiar).*(?:password|contrasena|clave).*?(?:login|iniciar sesion)|(?:login|iniciar sesion).*?(?:reemplazar|cambiar).*(?:password|contrasena|clave)/.test(actionText)) {
    const password = findElement(observation, ['password', 'contrasena', 'clave'], (element) => element.editable && (element.type === 'password' || /password|contrasena|clave/.test(elementCorpus(element))));
    if (password && rawData) return { action: 'type', target_ref: password.ref, value: rawData, submit_after_type: true, reason: 'Estrategia determinista del workflow: reemplazar la contrasena y enviar el login.', ...base };
  }

  // On a product-detail page there is a single visible purchase action.
  // Imported cases often call it "agregar desde el detalle" without
  // repeating the product name, so resolve it from the live page state.
  if (/inventory-item\.html/.test(currentUrl) && /(agregar|add to cart).*(?:detalle|carrito)|(?:detalle).*(agregar|carrito)/.test(actionText)) {
    const addToCart = visibleControl(['add to cart'], true);
    if (addToCart) return { action: 'click', target_ref: addToCart.ref, reason: 'Estrategia determinista del workflow: agregar el producto visible desde su detalle.', ...base };
  }

  const productFromStep = (() => {
    if (/sauce labs|test\.allthethings/i.test(rawData)) return rawData;
    const match = String(step.action || '').match(/(Sauce Labs [A-Za-z0-9(). -]+?|Test\.allTheThings\(\) T-Shirt \(Red\))(?=\s+(?:y\s+)?(?:abrir|completar|agregar|al carrito|checkout)|[.!;,]|$)/i);
    return match?.[1] || '';
  })();
  const cartIntent = /(add to cart|agregar(?:\s+el)?\s+(?:producto|sauce|test\.allthethings)|anadir(?:\s+el)?\s+producto)/.test(actionText);
  if (cartIntent && productFromStep) {
    const productTerms = productFromStep.split(/\s+/).map(normalizeText).filter((term) => term.length >= 3);
    const target = observation.elements.find((element) => {
      const isActionControl = element.tag === 'button' || ['button', 'menuitem'].includes(String(element.role || '').toLowerCase());
      return element.visible && !element.disabled && isActionControl
        && elementCorpus(element).includes('add to cart')
        && productTerms.every((term) => elementCorpus(element).includes(term));
    });
    if (target) {
      return { action: 'click', target_ref: target.ref, reason: `Estrategia determinista del workflow: agregar el producto indicado (${productFromStep}) al carrito.`, ...base };
    }
    // The same legacy step can request the next destination. Once the add
    // button changed to Remove, advance through the cart link using the live
    // state instead of repeating the product action.
    if (/(?:abrir|completar).*(?:carrito|checkout)|(?:carrito|checkout).*abrir/.test(actionText) && !/cart\.html/i.test(observation.url)) {
      const cart = visibleControl(['shopping_cart', 'shopping cart', 'cart']);
      if (cart) return { action: 'click', target_ref: cart.ref, reason: 'Estrategia determinista del workflow: abrir el carrito para continuar el flujo compuesto.', ...base };
    }
    if (/(?:abrir|completar).*(?:carrito|checkout)|(?:carrito|checkout).*abrir/.test(actionText) && /cart\.html/i.test(observation.url)) {
      const checkout = visibleControl(['checkout'], true);
      if (checkout) return { action: 'click', target_ref: checkout.ref, reason: 'Estrategia determinista del workflow: abrir Checkout desde el carrito.', ...base };
    }
  }

  if (/continue shopping/.test(actionText)) {
    const target = visibleControl(['continue shopping'], true);
    if (target) return { action: 'click', target_ref: target.ref, reason: 'Estrategia determinista del workflow: continuar comprando desde el carrito.', ...base };
  }

  // These controls have stable user-facing semantics across conventional web
  // flows. Resolving them from the live DOM lets a single legacy step advance
  // through a composed flow without storing implementation selectors.
  const semanticControls: Array<{ when: RegExp; terms: string[]; controlOnly?: boolean; reason: string }> = [
    { when: /reset app state/, terms: ['reset app state'], reason: 'restablecer el estado de la aplicacion' },
    { when: /(?:abrir|ir al).*carrito|icono.*carrito/, terms: ['shopping_cart', 'shopping cart', 'cart'], reason: 'abrir el carrito visible' },
    { when: /menu lateral|boton menu|abrir.*menu/, terms: ['react-burger-menu-btn', 'menu'], reason: 'abrir el menu lateral visible' },
    { when: /logout|cerrar sesion/, terms: ['logout'], reason: 'cerrar la sesion actual' },
    { when: /continue shopping/, terms: ['continue shopping'], reason: 'continuar comprando' },
    { when: /(?:hacer clic en |clic en )?checkout/, terms: ['checkout'], controlOnly: true, reason: 'abrir Checkout' },
    { when: /(?:hacer clic en |clic en )?continue/, terms: ['continue'], controlOnly: true, reason: 'continuar el checkout' },
    { when: /(?:hacer clic en |clic en )?finish|finalizar la compra/, terms: ['finish'], controlOnly: true, reason: 'finalizar la compra' },
    { when: /back home/, terms: ['back home'], controlOnly: true, reason: 'volver al inicio del catalogo' },
    { when: /back to products/, terms: ['back to products'], controlOnly: true, reason: 'volver al catalogo' },
    { when: /(?:hacer clic en |clic en )?cancel/, terms: ['cancel'], controlOnly: true, reason: 'cancelar el checkout' },
    { when: /cerrar.*(?:mensaje|alerta|error)/, terms: ['error-button', 'error button', 'close'], controlOnly: true, reason: 'cerrar el mensaje de error' },
  ];
  for (const control of semanticControls) {
    if (!control.when.test(actionText)) continue;
    const target = visibleControl(control.terms, control.controlOnly);
    if (target) return { action: 'click', target_ref: target.ref, reason: `Estrategia determinista del workflow: ${control.reason}.`, ...base };
  }

  const checkoutValues = rawData.split('/').map((value) => value.trim()).filter(Boolean);
  const mentionsCheckoutFields = /(first name|last name|postal code|codigo postal|completar datos|completar checkout)/.test(actionText);
  if (isTyping && mentionsCheckoutFields && checkoutValues.length >= 3) {
    const firstName = findElement(observation, ['first name', 'first_name'], (element) => element.editable && element.type !== 'password');
    const lastName = findElement(observation, ['last name', 'last_name'], (element) => element.editable && element.type !== 'password');
    const postalCode = findElement(observation, ['postal code', 'postal_code', 'zip'], (element) => element.editable && element.type !== 'password');
    if (firstName && lastName && postalCode) {
      const fields = [
        { target_ref: firstName.ref, value: checkoutValues[0] || '' },
        { target_ref: lastName.ref, value: checkoutValues[1] || '' },
        { target_ref: postalCode.ref, value: checkoutValues[2] || '' },
      ];
      const alreadyFilled = fields.every((field) => observation.elements.find((element) => element.ref === field.target_ref)?.value === field.value);
      if (!alreadyFilled) return { action: 'fill_form', fields, submit_after_type: false, reason: 'Estrategia determinista del workflow: completar los tres datos requeridos del checkout.', ...base };
      const continueButton = visibleControl(['continue'], true);
      if (continueButton) return { action: 'click', target_ref: continueButton.ref, reason: 'Estrategia determinista del workflow: continuar despues de completar los datos del checkout.', ...base };
    }
  }

  if (/(completar checkout|finalizar la compra|finalizar compra)/.test(actionText)) {
    const finishButton = visibleControl(['finish'], true);
    if (finishButton) return { action: 'click', target_ref: finishButton.ref, reason: 'Estrategia determinista del workflow: finalizar el checkout compuesto.', ...base };
  }

  if (isTyping && rawData) {
    const usernameRequested = /\b(username|usuario|user|email|login)\b/.test(actionText);
    const passwordRequested = /\b(password|contrasena|contraseña|clave)\b/.test(actionText);
    const compactCredentials = rawData.split('/').map((value) => value.trim()).filter(Boolean);
    if (compactCredentials.length === 2 && passwordRequested) {
      const usernameField = findElement(observation, ['username', 'usuario', 'email', 'login', 'user'], (element) => element.editable && element.type !== 'password');
      const passwordField = findElement(observation, ['password', 'contrasena', 'contraseña'], (element) => element.editable && element.type === 'password');
      if (usernameField && passwordField) {
        return {
          action: 'fill_form',
          fields: [
            { target_ref: usernameField.ref, value: compactCredentials[0] || '' },
            { target_ref: passwordField.ref, value: compactCredentials[1] || '' },
          ],
          submit_after_type: false,
          reason: 'Estrategia determinista del workflow: completar las credenciales compactas del paso.',
          ...base,
        };
      }
    }
    if (usernameRequested || passwordRequested) {
      const target = findElement(
        observation,
        usernameRequested ? ['username', 'usuario', 'email', 'login', 'user'] : ['password', 'contrasena', 'contraseña'],
        (element) => element.editable && (passwordRequested ? element.type === 'password' : element.type !== 'password'),
      );
      const loginAfterTyping = /(?:hacer clic|clic).*login/.test(actionText);
      if (target && loginAfterTyping && observation.elements.find((element) => element.ref === target.ref)?.value === rawData) {
        const login = visibleControl(['login'], true);
        if (login) return { action: 'click', target_ref: login.ref, reason: 'Estrategia determinista del workflow: enviar el login despues de reemplazar la credencial.', ...base };
      }
      if (target) {
        return {
          action: 'type',
          target_ref: target.ref,
          value: rawData,
          submit_after_type: false,
          reason: `Estrategia determinista del workflow: completar el campo visible ${usernameRequested ? 'de usuario' : 'de contrasena'} indicado por el paso.`,
          ...base,
        };
      }
    }
  }

  const isClick = /(hacer clic|\bclic\b|\bclick\b|pulsar|presionar|abrir)/.test(actionText);
  if (isClick && rawData) {
    const cartAction = actionText.match(/\b(add to cart|remove)\b/)?.[1];
    if (cartAction) {
      const productTerms = rawData.split(/\s+/).map(normalizeText).filter((term) => term.length >= 3);
      const target = observation.elements.find((element) => {
        // Product cards make their image and title clickable too. Restrict this
        // rule to controls so the workflow does not open a detail page instead
        // of changing the cart state.
        const isActionControl = element.tag === 'button' || ['button', 'menuitem'].includes(String(element.role || '').toLowerCase());
        if (!element.visible || element.disabled || !element.clickable || !isActionControl) return false;
        const corpus = elementCorpus(element);
        return corpus.includes(cartAction) && productTerms.every((term) => corpus.includes(term));
      });
      if (target) {
        return {
          action: 'click',
          target_ref: target.ref,
          reason: `Estrategia determinista del workflow: ${cartAction} para el producto indicado (${rawData}).`,
          ...base,
        };
      }
    }
    if (/(nombre del producto|detalle(?: del producto)?)/.test(actionText)) {
      const productTerms = rawData.split(/\s+/).map(normalizeText).filter((term) => term.length >= 3);
      const productLink = observation.elements.find((element) => element.visible && !element.disabled && element.clickable
        && (element.tag === 'a' || String(element.role || '').toLowerCase() === 'link')
        && productTerms.every((term) => elementCorpus(element).includes(term)));
      if (productLink) {
        return { action: 'click', target_ref: productLink.ref, reason: `Estrategia determinista del workflow: abrir el detalle del producto indicado (${rawData}).`, ...base };
      }
    }
    const terms = rawData
      .replace(/\b(boton|button|enlace|link)\b/gi, ' ')
      .split(/\s+/)
      .map(normalizeText)
      .filter((term) => term.length >= 2);
    const target = findElement(observation, terms, (element) => element.clickable && !element.disabled);
    if (target) {
      return {
        action: 'click',
        target_ref: target.ref,
        reason: `Estrategia determinista del workflow: activar el control visible indicado por el paso (${rawData}).`,
        ...base,
      };
    }
  }

  if (/(seleccionar|elegir|cambiar).*?(selector|orden|opcion|lista)|\bseleccionar\b/.test(actionText) && rawData) {
    const target = observation.elements.find((element) => element.visible && !element.disabled && element.tag === 'select');
    if (target) {
      return {
        action: 'select',
        target_ref: target.ref,
        value: rawData,
        reason: `Estrategia determinista del workflow: seleccionar la opcion visible indicada por el paso (${rawData}).`,
        ...base,
      };
    }
  }

  const isAssertion = /(comprobar|verificar|validar|confirmar|asegurar|contar)/.test(actionText);
  const expectedPrice = String(step.expected || '').match(/\$\d+(?:[.,]\d{2})?/);
  if (isAssertion && expectedPrice?.[0]) {
    return {
      action: 'assert_text',
      value: expectedPrice[0].replace('$', '').replace(',', '.'),
      reason: 'Estrategia determinista del workflow: comprobar el precio exacto indicado por el resultado esperado.',
      ...base,
    };
  }
  if (isAssertion) {
    // The runtime validation plan evaluates the expected DOM state after this
    // no-op action. This avoids delegating pure checks (URL, count or visible
    // content) to a generative model.
    return { action: 'finish', reason: 'Estrategia determinista del workflow: evaluar la evidencia actual con el contrato del paso.', ...base };
  }
  if (isAssertion && rawData) {
    const terms = rawData.split(/\s+/).map(normalizeText).filter((term) => term.length >= 3);
    const target = findElement(observation, terms, (element) => element.visible);
    if (target) {
      return {
        action: 'assert_visible',
        target_ref: target.ref,
        reason: `Estrategia determinista del workflow: comprobar que la evidencia visible indicada por el paso existe (${rawData}).`,
        ...base,
      };
    }
  }

  return null;
}

function assertionId(step: QAEngineStep, index: number): string {
  return `step-${step.number}-assertion-${index + 1}`;
}

function splitExpectation(value: string): string[] {
  return value
    .split(/(?:\s+y\s+|;|\n)/i)
    .map((item) => item.trim().replace(/[.!]+$/g, ''))
    .filter(Boolean);
}

function addAssertion(assertions: StepAssertion[], step: QAEngineStep, assertion: Omit<StepAssertion, 'id'>): void {
  const fingerprint = JSON.stringify([assertion.type, assertion.target, assertion.expected, assertion.alternatives]);
  if (assertions.some((item) => JSON.stringify([item.type, item.target, item.expected, item.alternatives]) === fingerprint)) return;
  assertions.push({ id: assertionId(step, assertions.length), ...assertion });
}

function parseExplicitAssertions(step: QAEngineStep, assertions: StepAssertion[], recognized: string[]): void {
  const data = parseStepData(step.data);
  const mappings: Array<{ keys: string[]; type: StepAssertion['type']; target?: string }> = [
    { keys: ['expected_text', 'texto_esperado'], type: 'text_contains' },
    { keys: ['expected_url', 'url_esperada'], type: 'url_matches' },
    { keys: ['status_code', 'http_status'], type: 'http_status' },
    { keys: ['expected_count', 'cantidad_esperada'], type: 'element_count', ...(data.count_target || data.objeto ? { target: data.count_target || data.objeto } : {}) },
  ];
  for (const { keys, type, target } of mappings) {
    const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(data, candidate));
    if (!key) continue;
    const raw = data[key] ?? '';
    addAssertion(assertions, step, {
      type,
      source: `${key}=${raw}`,
      ...(target ? { target } : {}),
      expected: type === 'http_status' || type === 'element_count' ? Number(raw) : raw,
      ...(type === 'element_count' ? { comparator: 'equals' as const } : {}),
    });
    recognized.push(`${key}=${raw}`);
  }
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith('json.')) continue;
    addAssertion(assertions, step, { type: 'json_field_equals', source: `${key}=${value}`, target: key.slice(5), expected: value });
    recognized.push(`${key}=${value}`);
  }
}

function parseExpectationFragment(step: QAEngineStep, fragment: string, assertions: StepAssertion[]): boolean {
  const normalized = normalizeText(fragment);
  const quoted = Array.from(fragment.matchAll(/["'“”]([^"'“”]{2,160})["'“”]/g)).map((match) => String(match[1]).trim());
  if (quoted.length) {
    quoted.forEach((value) => addAssertion(assertions, step, { type: 'text_contains', source: fragment, expected: value }));
    return true;
  }

  const status = normalized.match(/(?:status(?: code)?|codigo http)\s*[:=]?\s*(\d{3})/);
  if (status?.[1]) {
    addAssertion(assertions, step, { type: 'http_status', source: fragment, expected: Number(status[1]) });
    return true;
  }

  // Natural-language URL suffixes are common in imported test cases and are
  // deterministic to verify without asking the auditor to infer them.
  const urlSuffix = normalized.match(/(?:url|direccion|pagina)\s+(?:termina|finaliza|acaba)\s+(?:en|con)\s+([\w./-]+)/);
  if (urlSuffix?.[1]) {
    addAssertion(assertions, step, { type: 'url_matches', source: fragment, expected: urlSuffix[1].replace(/[.,;:]+$/g, '') });
    return true;
  }

  const urlContains = normalized.match(/(?:url|direccion|pagina)\s+(?:contiene|incluye)\s+([\w./-]+)/);
  if (urlContains?.[1]) {
    addAssertion(assertions, step, { type: 'url_matches', source: fragment, expected: urlContains[1].replace(/[.,;:]+$/g, '') });
    return true;
  }

  // Do not infer JSON fields from ordinary URLs such as inventory-item.html.
  // A JSON assertion is only valid when the expectation explicitly refers to
  // a JSON response/document.
  const jsonFields = /\b(?:json|respuesta)\b/.test(normalizeText(step.expected))
    ? Array.from(normalized.matchAll(/\b(status|items?|environment)\s*(?:es|=|:)?\s*([\w.-]+)/g))
    : [];
  if (jsonFields.length) {
    for (const match of jsonFields) {
      if (!match[1] || !match[2]) continue;
      const field = match[1] === 'item' ? 'items' : match[1];
      addAssertion(assertions, step, {
        type: 'json_field_equals',
        source: fragment,
        target: field,
        expected: match[2].replace(/[.,;:]+$/g, ''),
      });
    }
    return true;
  }

  const row = normalized.match(/fila de\s+([\w@.-]+).*?(?:indicar|mostrar|contener|dice|estado)\s+(.+)$/);
  if (row?.[1] && row[2]) {
    addAssertion(assertions, step, {
      type: 'element_contains',
      source: fragment,
      target: row[1],
      expected: row[2].trim(),
    });
    return true;
  }

  const count = normalized.match(/\b(\d+)\s+(productos?|filas?|items?|elementos?|imagenes?)\b/);
  if (count?.[1] && count[2]) {
    addAssertion(assertions, step, { type: 'element_count', source: fragment, target: count[2].replace(/s$/, ''), expected: Number(count[1]), comparator: 'equals' });
    return true;
  }

  if (/(imagenes?).*(cargan|cargadas|sin errores|ninguna.*rota)/.test(normalized)) {
    addAssertion(assertions, step, { type: 'images_loaded', source: fragment });
    return true;
  }
  if (/(titulo).*(obligatorio|required)|(?:obligatorio|required).*(titulo)/.test(normalized)) {
    addAssertion(assertions, step, { type: 'field_required', source: fragment, target: 'titulo' });
    return true;
  }
  if (/opcion alta.*seleccionada|alta queda seleccionada/.test(normalized)) {
    addAssertion(assertions, step, { type: 'option_selected', source: fragment, target: 'severity', expected: 'high' });
    return true;
  }
  if (/control.*marcado|queda marcado|confirmar datos.*activ/.test(normalized)) {
    addAssertion(assertions, step, { type: 'checkbox_checked', source: fragment, target: 'confirm' });
    return true;
  }
  const button = normalized.match(/boton\s+(.+?)(?:\s+esta\s+habilitado|\s+habilitado|\s+visible|$)/);
  if (button && button[1]) {
    addAssertion(assertions, step, {
      type: /habilitado/.test(normalized) ? 'button_enabled' : 'element_visible',
      source: fragment,
      target: button[1].trim(),
    });
    return true;
  }
  if (/(formulario).*(visible|disponible)|(?:visible|disponible).*(formulario)/.test(normalized)) {
    addAssertion(assertions, step, { type: 'element_visible', source: fragment, target: 'formulario' });
    return true;
  }
  if (/(error|invalid|incorrect).*(credencial|usuario|password|contrasena)|(?:credencial|usuario|password|contrasena).*(error|invalid|incorrect)/.test(normalized)) {
    addAssertion(assertions, step, {
      type: 'text_contains_any', source: fragment,
      alternatives: ['invalid', 'incorrect', 'error', 'invalido', 'invalida', 'incorrecto', 'incorrecta'],
    });
    return true;
  }
  if (/(no se ingreso|no ingresar|fuera).*(area segura|secure area)/.test(normalized)) {
    addAssertion(assertions, step, { type: 'url_not_matches', source: fragment, expected: '/secure' });
    return true;
  }

  const visibleContent = normalized.match(/(?:mostrar(?:se)?|muestra|contener|contiene|aparece|verse|visualiza(?:rse)?|informa(?:r)?|indicar)\s+(.+)$/);
  if (visibleContent?.[1]) {
    const expected = visibleContent[1]
      .replace(/^(?:inmediatamente\s+)?(?:el|la|los|las)\s+/, '')
      .replace(/^(?:exactamente\s+)?(?:el|la|los|las)?\s*(?:titulo|mensaje|nombre)\s+/, '')
      .trim();
    const wordCount = expected.split(/\s+/).filter(Boolean).length;
    if (expected.length >= 3 && wordCount <= 10 && !/\s+o\s+/.test(expected)) {
      addAssertion(assertions, step, { type: 'text_contains', source: fragment, expected });
      return true;
    }
  }
  return false;
}

export function buildStepContract(step: QAEngineStep): StepContract {
  if (step.validation_plan) {
    const assertions = step.validation_plan.assertions.map((item, index) => ({
      ...item,
      id: assertionId(step, index),
    }));
    const isDomPlan = step.validation_plan.mode === 'dom' && assertions.length > 0;
    return {
      version: 1,
      step_number: step.number,
      assertions,
      recognized_fragments: isDomPlan ? [step.validation_plan.reason] : [],
      unresolved_fragments: isDomPlan ? [] : (step.expected ? [step.expected] : []),
      coverage: isDomPlan ? 'full' : 'none',
      requires_semantic_audit: !isDomPlan,
    };
  }
  const assertions: StepAssertion[] = [];
  const recognizedFragments: string[] = [];
  const unresolvedFragments: string[] = [];
  parseExplicitAssertions(step, assertions, recognizedFragments);
  for (const fragment of splitExpectation(String(step.expected || ''))) {
    if (parseExpectationFragment(step, fragment, assertions)) recognizedFragments.push(fragment);
    else unresolvedFragments.push(fragment);
  }
  const coverage: StepContract['coverage'] = assertions.length === 0
    ? 'none'
    : unresolvedFragments.length === 0 ? 'full' : 'partial';
  return {
    version: 1,
    step_number: step.number,
    assertions,
    recognized_fragments: recognizedFragments,
    unresolved_fragments: unresolvedFragments,
    coverage,
    requires_semantic_audit: coverage !== 'full',
  };
}

function corpus(observation: Pick<BrowserObservation, 'url' | 'title' | 'visibleText' | 'bodyText' | 'elements'>): string {
  return normalizeText([
    observation.url, observation.title, observation.bodyText, ...observation.visibleText,
    ...observation.elements.map((element) => elementCorpus(element)),
  ].join(' '));
}

function matchingElement(observation: BrowserObservation, target: string): BrowserElementSnapshot | undefined {
  const expected = normalizeText(target);
  if (expected === 'formulario') return observation.elements.find((element) => element.visible && element.editable);
  return observation.elements.find((element) => element.visible && elementCorpus(element).includes(expected));
}

function containsNormalizedPhrase(value: string, expected: unknown): boolean {
  const phrase = normalizeText(expected).trim();
  if (!phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`).test(normalizeText(value));
}

export function evaluateStepContract(
  contract: StepContract,
  before: Pick<BrowserObservation, 'url'>,
  after: BrowserObservation,
): { ok: boolean; conclusive: boolean; reason: string; results: StepAssertionResult[] } {
  const text = corpus(after);
  const results = contract.assertions.map((assertion): StepAssertionResult => {
    let ok = false;
    let actual = '';
    switch (assertion.type) {
      case 'text_contains':
        ok = text.includes(normalizeText(assertion.expected));
        break;
      case 'text_contains_any':
        ok = (assertion.alternatives || []).some((value) => text.includes(normalizeText(value)));
        break;
      case 'element_contains': {
        const element = matchingElement(after, assertion.target || '');
        actual = element ? elementCorpus(element) : '';
        ok = Boolean(element && containsNormalizedPhrase(actual, assertion.expected));
        break;
      }
      case 'url_matches':
        ok = normalizeText(after.url).includes(normalizeText(assertion.expected));
        actual = after.url;
        break;
      case 'url_not_matches':
        ok = !normalizeText(after.url).includes(normalizeText(assertion.expected));
        actual = after.url;
        break;
      case 'url_changed':
        ok = normalizeText(before.url) !== normalizeText(after.url);
        actual = after.url;
        break;
      case 'http_status': {
        const match = normalizeText(after.bodyText).match(/(?:status(?: code)?|codigo http)\s*[:=]?\s*(\d{3})/);
        actual = match?.[1] || '';
        ok = Number(actual) === Number(assertion.expected);
        break;
      }
      case 'json_field_equals': {
        try {
          const jsonText = after.bodyText.match(/\{[\s\S]*\}/)?.[0] || '';
          const parsed = JSON.parse(jsonText);
          const value = String(assertion.target || '').split('.').reduce((current: any, key) => current?.[key], parsed);
          actual = String(value ?? '');
          ok = actual === String(assertion.expected);
        } catch { ok = false; }
        break;
      }
      case 'element_count': {
        const target = normalizeText(assertion.target || '');
        const targetPattern = target.includes('_')
          ? new RegExp(`(?:^|\\s)${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`)
          : null;
        let count = after.elements.filter((element) => {
          if (!element.visible || !target) return element.visible;
          const value = elementCorpus(element);
          return targetPattern ? targetPattern.test(value) : value.includes(target);
        }).length;
        if (count === 0 && target) {
          const singular = target.replace(/s$/, '');
          const bodyMatch = normalizeText(after.bodyText).match(new RegExp(`\\b(\\d+)\\s+${singular}s?\\b`));
          if (bodyMatch?.[1]) count = Number(bodyMatch[1]);
        }
        actual = String(count);
        ok = assertion.comparator === 'at_least' ? count >= Number(assertion.expected) : count === Number(assertion.expected);
        break;
      }
      case 'field_required': {
        const element = matchingElement(after, assertion.target || '');
        actual = element ? `${Boolean(element.required)}/${String(element.valid)}` : 'missing';
        ok = Boolean(element?.required && element.valid === false);
        break;
      }
      case 'option_selected': {
        const element = matchingElement(after, assertion.target || '');
        actual = (element?.selectedValues || []).join(',');
        ok = (element?.selectedValues || []).some((value) => normalizeText(value) === normalizeText(assertion.expected));
        break;
      }
      case 'checkbox_checked': {
        const element = matchingElement(after, assertion.target || '');
        actual = String(Boolean(element?.checked));
        ok = Boolean(element?.checked);
        break;
      }
      case 'button_enabled': {
        const element = matchingElement(after, assertion.target || '');
        actual = element ? String(!element.disabled) : 'missing';
        ok = Boolean(element && !element.disabled);
        break;
      }
      case 'images_loaded': {
        const images = after.elements.filter((element) => element.tag === 'img');
        const broken = images.filter((element) => !element.imageComplete || Number(element.naturalWidth || 0) <= 0);
        actual = `${images.length - broken.length}/${images.length}`;
        ok = images.length > 0 && broken.length === 0;
        break;
      }
      case 'element_visible':
      case 'element_value': {
        const element = matchingElement(after, assertion.target || '');
        actual = element?.value || element?.text || '';
        ok = assertion.type === 'element_visible'
          ? Boolean(element)
          : Boolean(element && String(element.value || '') === String(assertion.expected || ''));
        break;
      }
    }
    return {
      assertion,
      ok,
      reason: `${assertion.type} ${ok ? 'cumplida' : 'no cumplida'}${actual ? ` (observado: ${actual})` : ''}`,
    };
  });
  const failed = results.filter((result) => !result.ok);
  const conclusive = failed.length > 0 || (contract.coverage === 'full' && results.length > 0);
  const reason = results.length === 0
    ? 'El resultado esperado requiere auditoria semantica; no se reconocieron aserciones tipadas.'
    : failed.length
      ? failed.map((result) => result.reason).join(' | ')
      : contract.coverage === 'full'
        ? `Contrato comprobado: ${results.length} asercion(es) cumplidas.`
        : `Aserciones reconocidas cumplidas, pero quedan ${contract.unresolved_fragments.length} fragmento(s) para auditoria semantica.`;
  return { ok: failed.length === 0, conclusive, reason, results };
}
