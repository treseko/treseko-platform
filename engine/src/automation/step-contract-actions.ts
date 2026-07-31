import type {
  BrowserElementSnapshot,
  BrowserObservation,
  QAEngineStep,
  StepAssertion,
  StepAssertionResult,
  StepContract,
  StrictAIAction,
} from './action-types.ts';

import { elementCorpus, normalizeText, parseStepData } from './step-contract-base.ts';

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
