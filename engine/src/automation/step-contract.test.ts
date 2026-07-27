import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStepContract, evaluateStepContract, inferConventionalUiAction, parseStepData } from './step-contract.ts';

test('parseStepData separa claves delimitadas por espacios', () => {
  assert.deepEqual(parseStepData('username=qa_user password=correct-pass'), {
    username: 'qa_user',
    password: 'correct-pass',
  });
});

test('parseStepData conserva espacios dentro de valores', () => {
  assert.deepEqual(parseStepData('title=Revision de checkout severity=high confirmed=true'), {
    title: 'Revision de checkout',
    severity: 'high',
    confirmed: 'true',
  });
});

test('parseStepData conserva valores vacios', () => {
  assert.deepEqual(parseStepData('title='), { title: '' });
});

test('parseStepData admite valores entre comillas', () => {
  assert.deepEqual(parseStepData('title="Revision de checkout"; severity=high'), {
    title: 'Revision de checkout',
    severity: 'high',
  });
});

test('un contrato parcial exige auditoria semantica y no aprueba de forma concluyente', () => {
  const step = { number: 1, expected: 'Debe mostrar "Guardado" y conservar el orden correcto del flujo' };
  const contract = buildStepContract(step);
  assert.equal(contract.coverage, 'partial');
  assert.equal(contract.requires_semantic_audit, true);
  const evaluation = evaluateStepContract(contract, { url: 'https://example.test' }, {
    url: 'https://example.test', title: 'OK', readyState: 'complete', loadingSignals: [], dialogs: [],
    visibleText: ['Guardado'], bodyText: 'Guardado', elements: [], forms: [],
  });
  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.conclusive, false);
});

test('un contrato tipado completo detecta un fallo concluyente', () => {
  const contract = buildStepContract({ number: 2, expected: 'Debe aparecer un error de credenciales invalidas' });
  const evaluation = evaluateStepContract(contract, { url: 'https://example.test/login' }, {
    url: 'https://example.test/login', title: 'Login', readyState: 'complete', loadingSignals: [], dialogs: [],
    visibleText: ['Welcome'], bodyText: 'Welcome', elements: [], forms: [],
  });
  assert.equal(contract.coverage, 'full');
  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.conclusive, true);
});

test('credenciales estructuradas no implican enviar el formulario', async () => {
  const { inferStructuredAction } = await import('./step-contract.ts');
  const action = inferStructuredAction({ number: 1, action: 'Ingresar credenciales', data: 'username=qa password=secret' }, {
    url: 'https://example.test/login', title: 'Login', readyState: 'complete', loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', forms: [],
    elements: [
      { ref: 'user', tag: 'input', type: 'text', label: 'Username', disabled: false, visible: true, editable: true, clickable: true },
      { ref: 'pass', tag: 'input', type: 'password', label: 'Password', disabled: false, visible: true, editable: true, clickable: true },
    ],
  });
  assert.equal(action?.action, 'fill_form');
  assert.equal(action?.submit_after_type, false);
});

test('credenciales estructuradas separadas se resuelven sin depender del modelo', async () => {
  const { inferStructuredAction } = await import('./step-contract.ts');
  const observation = {
    url: 'https://example.test/login', title: 'Login', readyState: 'complete' as const, loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', forms: [],
    elements: [
      { ref: 'user', tag: 'input', type: 'text', label: 'Username', disabled: false, visible: true, editable: true, clickable: true },
      { ref: 'pass', tag: 'input', type: 'password', label: 'Password', disabled: false, visible: true, editable: true, clickable: true },
    ],
  };
  assert.deepEqual(inferStructuredAction({ number: 1, action: 'Ingresar el usuario en el campo Username.', data: 'username=standard_user' }, observation), {
    action: 'type', target_ref: 'user', value: 'standard_user', submit_after_type: false,
    reason: 'Completar el usuario estructurado sin enviar el formulario.', confidence: 100, step_number: 1,
  });
  assert.equal(inferStructuredAction({ number: 2, action: 'Ingresar la contrasena.', data: 'password=secret_sauce' }, observation)?.target_ref, 'pass');
});

test('el envio de login visible se resuelve sin depender del modelo', async () => {
  const { inferStructuredAction } = await import('./step-contract.ts');
  const action = inferStructuredAction({ number: 4, action: 'Presionar el boton Login.', expected: 'El texto Products es visible.' }, {
    url: 'https://example.test/login', title: 'Login', readyState: 'complete', loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', forms: [],
    elements: [{ ref: 'login', tag: 'button', text: 'Login', disabled: false, visible: true, editable: false, clickable: true }],
  });
  assert.deepEqual(action, {
    action: 'click', target_ref: 'login', reason: 'Activar el boton Login visible indicado por el paso.',
    confidence: 100, step_number: 4, expected: 'El texto Products es visible.',
  });
});

test('un paso compuesto envia el formulario solo cuando lo solicita explicitamente', async () => {
  const { inferStructuredAction } = await import('./step-contract.ts');
  const action = inferStructuredAction({
    number: 2,
    action: 'Ingresar las credenciales validas y enviar.',
    data: 'username=qa_user password=correct-pass',
  }, {
    url: 'https://example.test/login', title: 'Login', readyState: 'complete', loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', forms: [],
    elements: [
      { ref: 'user', tag: 'input', type: 'text', label: 'Username', disabled: false, visible: true, editable: true, clickable: true },
      { ref: 'pass', tag: 'input', type: 'password', label: 'Password', disabled: false, visible: true, editable: true, clickable: true },
    ],
  });
  assert.equal(action?.action, 'fill_form');
  assert.equal(action?.submit_after_type, true);
});

test('la estrategia de workflow resuelve los tres campos convencionales de un login', () => {
  const observation = {
    url: 'https://example.test/login', title: 'Login', readyState: 'complete' as const, loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', forms: [],
    elements: [
      { ref: 'user', tag: 'input', type: 'text', label: 'Username', disabled: false, visible: true, editable: true, clickable: true },
      { ref: 'pass', tag: 'input', type: 'password', label: 'Password', disabled: false, visible: true, editable: true, clickable: true },
      { ref: 'login', tag: 'button', text: 'Login', disabled: false, visible: true, editable: false, clickable: true },
      { ref: 'product', tag: 'a', text: 'Sauce Labs Backpack', disabled: false, visible: true, editable: false, clickable: true },
    ],
  };
  assert.deepEqual(inferConventionalUiAction({ number: 1, action: 'Escribir el usuario estandar en el campo Username.', data: 'standard_user' }, observation)?.action, 'type');
  assert.deepEqual(inferConventionalUiAction({ number: 2, action: 'Escribir la contrasena en el campo Password.', data: 'secret_sauce' }, observation)?.target_ref, 'pass');
  assert.deepEqual(inferConventionalUiAction({ number: 3, action: 'Hacer clic en el boton Login.', data: 'Boton Login' }, observation)?.target_ref, 'login');
  assert.deepEqual(inferConventionalUiAction({ number: 4, action: 'Comprobar que se muestra el producto.', data: 'Sauce Labs Backpack' }, observation)?.action, 'finish');
});

test('la estrategia de workflow selecciona opciones visibles sin delegarlas al modelo', () => {
  const action = inferConventionalUiAction({ number: 5, action: 'Seleccionar Price (low to high) en el selector de orden.', data: 'Price (low to high)' }, {
    url: 'https://example.test/inventory', title: 'Products', readyState: 'complete', loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', forms: [],
    elements: [{ ref: 'sort', tag: 'select', label: 'Product Sort Container', disabled: false, visible: true, editable: true, clickable: true }],
  });
  assert.equal(action?.action, 'select');
  assert.equal(action?.target_ref, 'sort');
  assert.equal(action?.value, 'Price (low to high)');
});

test('la estrategia de workflow vincula Add to cart al producto de su tarjeta', () => {
  const action = inferConventionalUiAction({ number: 6, action: 'Hacer clic en Add to cart del producto.', data: 'Sauce Labs Fleece Jacket' }, {
    url: 'https://example.test/inventory', title: 'Products', readyState: 'complete', loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', forms: [],
    elements: [
      { ref: 'product-link', tag: 'a', text: 'Sauce Labs Fleece Jacket', disabled: false, visible: true, editable: false, clickable: true },
      { ref: 'add-jacket', tag: 'button', text: 'Add to cart', name: 'Sauce Labs Fleece Jacket Add to cart', disabled: false, visible: true, editable: false, clickable: true },
    ],
  });
  assert.equal(action?.target_ref, 'add-jacket');
});

test('la estrategia extrae el producto de un paso compuesto de checkout', () => {
  const action = inferConventionalUiAction({ number: 6, action: 'Agregar Sauce Labs Onesie y completar checkout.', data: 'Ana / QA / 1000' }, {
    url: 'https://example.test/inventory', title: 'Products', readyState: 'complete', loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', forms: [],
    elements: [{ ref: 'add-onesie', tag: 'button', text: 'Add to cart', name: 'Sauce Labs Onesie Add to cart', disabled: false, visible: true, editable: false, clickable: true }],
  });
  assert.equal(action?.target_ref, 'add-onesie');
});

test('la estrategia de workflow no confunde el enlace de una tarjeta con su boton de carrito', () => {
  const action = inferConventionalUiAction({ number: 6, action: 'Hacer clic en Remove del mismo producto.', data: 'Sauce Labs Fleece Jacket' }, {
    url: 'https://example.test/inventory', title: 'Products', readyState: 'complete', loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', forms: [],
    elements: [
      { ref: 'product-link', tag: 'a', text: 'Sauce Labs Fleece Jacket', name: 'Sauce Labs Fleece Jacket Remove', disabled: false, visible: true, editable: false, clickable: true },
      { ref: 'product-image', tag: 'img', name: 'Sauce Labs Fleece Jacket Remove', disabled: false, visible: true, editable: false, clickable: true },
      { ref: 'remove-jacket', tag: 'button', text: 'Remove', name: 'Sauce Labs Fleece Jacket Remove', disabled: false, visible: true, editable: false, clickable: true },
    ],
  });
  assert.equal(action?.target_ref, 'remove-jacket');
});

test('la estrategia de workflow abre el enlace del producto indicado y no otro resultado parcial', () => {
  const action = inferConventionalUiAction({ number: 7, action: 'Hacer clic en el nombre del producto.', data: 'Sauce Labs Bike Light' }, {
    url: 'https://example.test/inventory', title: 'Products', readyState: 'complete' as const, loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', forms: [],
    elements: [
      { ref: 'backpack', tag: 'a', text: 'Sauce Labs Backpack', disabled: false, visible: true, editable: false, clickable: true },
      { ref: 'bike', tag: 'a', text: 'Sauce Labs Bike Light', disabled: false, visible: true, editable: false, clickable: true },
    ],
  });
  assert.equal(action?.target_ref, 'bike');
});

test('la estrategia completa credenciales compactas sin enviarlas', () => {
  const action = inferConventionalUiAction({ number: 8, action: 'Ingresar standard_user y una clave invalida.', data: 'standard_user / clave_invalida' }, {
    url: 'https://example.test/login', title: 'Login', readyState: 'complete' as const, loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', forms: [],
    elements: [
      { ref: 'user', tag: 'input', type: 'text', label: 'Username', disabled: false, visible: true, editable: true, clickable: true },
      { ref: 'pass', tag: 'input', type: 'password', label: 'Password', disabled: false, visible: true, editable: true, clickable: true },
    ],
  });
  assert.equal(action?.action, 'fill_form');
  assert.deepEqual(action?.fields?.map((field) => field.value), ['standard_user', 'clave_invalida']);
});

test('la estrategia verifica un precio esperado sin solicitar una decision al modelo', () => {
  const action = inferConventionalUiAction({ number: 9, action: 'Comprobar el precio del producto.', data: 'Precio', expected: 'Se muestra exactamente $15.99.' }, {
    url: 'https://example.test/item', title: 'Item', readyState: 'complete' as const, loadingSignals: [], dialogs: [], visibleText: ['$15.99'], bodyText: '$15.99', forms: [], elements: [],
  });
  assert.equal(action?.action, 'assert_text');
  assert.equal(action?.value, '15.99');
});

test('la estrategia resuelve cierre de error y apertura de detalle convencionales', () => {
  const errorAction = inferConventionalUiAction({ number: 10, action: 'Cerrar el mensaje de error.', data: 'Boton X del mensaje' }, {
    url: 'https://example.test/login', title: 'Login', readyState: 'complete' as const, loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', forms: [],
    elements: [{ ref: 'close-error', tag: 'button', name: 'error-button', text: 'X', disabled: false, visible: true, editable: false, clickable: true }],
  });
  assert.equal(errorAction?.target_ref, 'close-error');

  const detailAction = inferConventionalUiAction({ number: 11, action: 'Abrir el detalle del producto.', data: 'Sauce Labs Backpack' }, {
    url: 'https://example.test/inventory', title: 'Products', readyState: 'complete' as const, loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', forms: [],
    elements: [{ ref: 'backpack', tag: 'a', text: 'Sauce Labs Backpack', disabled: false, visible: true, editable: false, clickable: true }],
  });
  assert.equal(detailAction?.target_ref, 'backpack');
});

test('la estrategia completa una compra compuesta usando el estado actual', () => {
  const action = inferConventionalUiAction({ number: 12, action: 'Agregar Sauce Labs Onesie y completar checkout.', data: 'Ana / QA / 1000' }, {
    url: 'https://example.test/checkout-step-one.html', title: 'Checkout', readyState: 'complete' as const, loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', forms: [],
    elements: [
      { ref: 'first', tag: 'input', type: 'text', label: 'First Name', disabled: false, visible: true, editable: true, clickable: true },
      { ref: 'last', tag: 'input', type: 'text', label: 'Last Name', disabled: false, visible: true, editable: true, clickable: true },
      { ref: 'postal', tag: 'input', type: 'text', label: 'Postal Code', disabled: false, visible: true, editable: true, clickable: true },
    ],
  });
  assert.equal(action?.action, 'fill_form');
  assert.deepEqual(action?.fields?.map((field) => field.value), ['Ana', 'QA', '1000']);
});

test('contrato JSON compara campos observables sin depender del LLM', () => {
  const contract = buildStepContract({ number: 3, expected: 'El JSON muestra status failed e items 99' });
  const evaluation = evaluateStepContract(contract, { url: 'https://example.test/api' }, {
    url: 'https://example.test/api', title: 'API', readyState: 'complete', loadingSignals: [], dialogs: [],
    visibleText: ['{"status":"ok","items":99}'], bodyText: '{"status":"ok","items":99}', elements: [], forms: [],
  });
  assert.equal(contract.coverage, 'full');
  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.conclusive, true);
});

test('contrato de respuesta JSON conserva el contexto entre campos coordinados', () => {
  const contract = buildStepContract({ number: 13, expected: 'La respuesta contiene status ok, items 3 y environment qa.' });
  const evaluation = evaluateStepContract(contract, { url: 'https://example.test/api' }, {
    url: 'https://example.test/api', title: 'API JSON', readyState: 'complete', loadingSignals: [], dialogs: [],
    visibleText: ['{"status":"ok","items":3,"environment":"qa"}'], bodyText: '{"status":"ok","items":3,"environment":"qa"}', elements: [], forms: [],
  });
  assert.equal(contract.coverage, 'full');
  assert.deepEqual(contract.assertions.map((item) => [item.type, item.target, item.expected]), [
    ['json_field_equals', 'status', 'ok'],
    ['json_field_equals', 'items', '3'],
    ['json_field_equals', 'environment', 'qa'],
  ]);
  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.conclusive, true);
});

test('contrato de fila limita la comprobacion al elemento correcto', () => {
  const contract = buildStepContract({ number: 4, expected: 'La fila de ana@example.test debe indicar Activa' });
  const evaluation = evaluateStepContract(contract, { url: 'https://example.test/users' }, {
    url: 'https://example.test/users', title: 'Users', readyState: 'complete', loadingSignals: [], dialogs: [],
    visibleText: ['ana@example.test Inactiva', 'otro@example.test Activa'], bodyText: 'ana@example.test Inactiva otro@example.test Activa', forms: [],
    elements: [
      { ref: 'row-ana', tag: 'tr', text: 'ana@example.test Inactiva', disabled: false, visible: true, editable: false, clickable: false },
      { ref: 'row-other', tag: 'tr', text: 'otro@example.test Activa', disabled: false, visible: true, editable: false, clickable: false },
    ],
  });
  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.conclusive, true);
});

test('frase visible breve se tipa, una expectativa ambigua queda para auditoria semantica', () => {
  const brief = buildStepContract({ number: 5, expected: 'La pagina muestra Operacion completada' });
  const ambiguous = buildStepContract({ number: 6, expected: 'La pagina debe verse correcta o razonablemente completa para el usuario final' });
  assert.equal(brief.coverage, 'full');
  assert.equal(brief.assertions[0]?.type, 'text_contains');
  assert.equal(ambiguous.coverage, 'none');
  assert.equal(ambiguous.requires_semantic_audit, true);
});

test('tipa URL y contenido visual expresados en lenguaje natural', () => {
  const urlContract = buildStepContract({ number: 7, expected: 'La URL termina en saucedemo.com y el formulario de acceso esta visible.' });
  const containedUrl = buildStepContract({ number: 9, expected: 'La URL contiene inventory-item.html.' });
  const contentContract = buildStepContract({ number: 8, expected: 'Se visualiza exactamente el nombre Sauce Labs Backpack.' });
  assert.equal(urlContract.coverage, 'full');
  assert.ok(urlContract.assertions.some((item) => item.type === 'url_matches' && item.expected === 'saucedemo.com'));
  assert.ok(containedUrl.assertions.some((item) => item.type === 'url_matches' && item.expected === 'inventory-item.html'));
  assert.equal(contentContract.coverage, 'full');
  assert.ok(contentContract.assertions.some((item) => item.type === 'text_contains' && item.expected === 'sauce labs backpack'));
});

test('el conteo de tarjetas no incluye elementos internos con el mismo prefijo', () => {
  const contract = buildStepContract({ number: 10, data: 'expected_count=1 count_target=inventory_item' });
  const evaluation = evaluateStepContract(contract, { url: 'https://example.test/inventory' }, {
    url: 'https://example.test/inventory', title: 'Products', readyState: 'complete', loadingSignals: [], dialogs: [], visibleText: [], bodyText: '', forms: [],
    elements: [
      { ref: 'card', tag: 'div', name: 'inventory_item', disabled: false, visible: true, editable: false, clickable: false },
      { ref: 'title', tag: 'a', name: 'inventory_item_name', text: 'Sauce Labs Backpack', disabled: false, visible: true, editable: false, clickable: true },
    ],
  });
  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.results[0]?.reason, 'element_count cumplida (observado: 1)');
});
