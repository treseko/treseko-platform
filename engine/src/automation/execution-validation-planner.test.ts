import test from 'node:test';
import assert from 'node:assert/strict';
import { planStep } from './execution-validation-planner.ts';
import { buildStepContract } from './step-contract.ts';

test('plans a login form as visible controls instead of literal prose', () => {
  const validation_plan = planStep({
    number: 1,
    expected: 'Se muestra el formulario de acceso con los campos Username y Password visibles.',
  });
  const contract = buildStepContract({ number: 1, expected: 'ignored', validation_plan });
  assert.equal(validation_plan.mode, 'dom');
  assert.deepEqual(contract.assertions.map((item) => [item.type, item.target]), [
    ['element_visible', 'username'],
    ['element_visible', 'password'],
  ]);
  assert.equal(contract.coverage, 'full');
});

test('keeps ambiguous expectations available for semantic audit', () => {
  const plan = planStep({ number: 2, expected: 'La experiencia de compra se ve correcta.' });
  assert.equal(plan.mode, 'visual_semantic');
  assert.equal(plan.assertions.length, 0);
});

test('plans entered input data as an element value, not visible page text', () => {
  const plan = planStep({
    number: 2,
    action: 'Escribir el usuario estandar en el campo Username.',
    data: 'standard_user',
    expected: 'El campo Username muestra exactamente standard_user.',
  });
  assert.equal(plan.mode, 'dom');
  assert.deepEqual(plan.assertions, [{
    type: 'element_value',
    source: 'El campo Username muestra exactamente standard_user.',
    target: 'username',
    expected: 'standard_user',
  }]);
});

test('does not turn a credential error message into an input value assertion', () => {
  const plan = planStep({
    number: 4,
    action: 'Hacer clic en Login.',
    data: 'Boton Login',
    expected: 'Se muestra Epic sadface: Username and password do not match.',
  });
  assert.equal(plan.mode, 'dom');
  assert.ok(plan.assertions.some((item) => item.type === 'text_contains_any'));
  assert.ok(!plan.assertions.some((item) => item.type === 'element_value'));
});

test('plans closing an error message as an absent error control', () => {
  const plan = planStep({ number: 3, action: 'Cerrar el mensaje de error.', expected: 'El mensaje de error deja de estar visible.' });
  assert.equal(plan.mode, 'dom');
  assert.deepEqual(plan.assertions.map((item) => [item.type, item.target, item.expected]), [['element_count', 'error-button', 0]]);
});

test('plans menu logout evidence without semantic audit', () => {
  const menuPlan = planStep({ number: 5, expected: 'La opcion Logout esta visible.' });
  assert.equal(menuPlan.mode, 'dom');
  assert.deepEqual(menuPlan.assertions.map((item) => [item.type, item.target]), [['element_visible', 'logout']]);

  const logoutPlan = planStep({ number: 6, expected: 'La URL vuelve a / y Username esta visible.' });
  assert.equal(logoutPlan.mode, 'dom');
  assert.ok(logoutPlan.assertions.some((item) => item.type === 'element_visible' && item.target === 'username'));
});

test('does not treat an explicit cart return as a logout', () => {
  const plan = planStep({ number: 6, expected: 'La URL vuelve a /cart.html y Sauce Labs Backpack sigue visible.' });
  assert.equal(plan.mode, 'dom');
  assert.ok(plan.assertions.some((item) => item.type === 'url_matches' && item.expected === '/cart.html'));
  assert.ok(!plan.assertions.some((item) => item.target === 'username'));
});

test('plans the visible product and price from a natural-language sorting result', () => {
  const plan = planStep({
    number: 5,
    action: 'Seleccionar Price (low to high) en el selector de orden.',
    data: 'Price (low to high)',
    expected: 'El primer producto visible es Sauce Labs Onesie con precio $7.99.',
  });
  assert.equal(plan.mode, 'dom');
  assert.deepEqual(plan.assertions.map((item) => item.expected), ['Sauce Labs Onesie', '$7.99']);
});

test('plans the first visible product for a sorting result without price', () => {
  const plan = planStep({
    number: 5,
    action: 'Seleccionar Name (Z to A) en el selector de orden.',
    data: 'Name (Z to A)',
    expected: 'El primer producto visible es Test.allTheThings() T-Shirt (Red).',
  });
  assert.equal(plan.mode, 'dom');
  assert.deepEqual(plan.assertions.map((item) => [item.type, item.target, item.expected]), [
    ['element_contains', 'inventory_item', 'Test.allTheThings() T-Shirt (Red)'],
  ]);
});

test('plans cart button and badge transitions without requiring semantic audit', () => {
  const added = planStep({
    number: 5,
    action: 'Hacer clic en Add to cart del producto.',
    data: 'Sauce Labs Fleece Jacket',
    expected: 'El boton del producto cambia a Remove y el badge del carrito muestra 1.',
  });
  const removed = planStep({
    number: 6,
    action: 'Hacer clic en Remove del mismo producto.',
    data: 'Sauce Labs Fleece Jacket',
    expected: 'El boton vuelve a mostrar Add to cart y el badge del carrito desaparece.',
  });
  assert.equal(added.mode, 'dom');
  assert.deepEqual(added.assertions.map((item) => item.type), ['element_visible', 'element_contains']);
  assert.equal(removed.mode, 'dom');
  assert.deepEqual(removed.assertions.map((item) => item.type), ['element_visible', 'element_count']);
});

test('plans a pair of visible entities without requiring semantic audit', () => {
  const plan = planStep({
    number: 7,
    action: 'Abrir el carrito.',
    expected: 'Se visualizan Sauce Labs Backpack y Sauce Labs Bike Light.',
  });
  assert.equal(plan.mode, 'dom');
  assert.deepEqual(plan.assertions.map((item) => [item.type, item.expected]), [
    ['text_contains', 'Sauce Labs Backpack'],
    ['text_contains', 'Sauce Labs Bike Light'],
  ]);
});

test('plans an empty cart as absence of item controls', () => {
  const plan = planStep({
    number: 7,
    action: 'Hacer clic en Remove.',
    expected: 'No se muestran productos en el carrito.',
  });
  assert.equal(plan.mode, 'dom');
  assert.deepEqual(plan.assertions.map((item) => [item.type, item.target, item.expected]), [
    ['element_count', 'remove', 0],
  ]);
});

test('plans the three checkout field values from conventional data', () => {
  const plan = planStep({
    number: 6,
    action: 'Completar First Name con Ana, Last Name con QA y Postal Code con 1000.',
    data: 'Ana / QA / 1000',
    expected: 'Los tres campos contienen los valores indicados.',
  });
  assert.equal(plan.mode, 'dom');
  assert.deepEqual(plan.assertions.map((item) => item.type), ['element_value', 'element_value', 'element_value']);
});

test('plans a visible product name and price as DOM evidence', () => {
  const plan = planStep({ number: 7, expected: 'Se muestran Sauce Labs Fleece Jacket y $49.99.' });
  assert.equal(plan.mode, 'dom');
  assert.deepEqual(plan.assertions.map((item) => item.expected), ['Sauce Labs Fleece Jacket', '$49.99']);
});

test('plans an exact price using its numeric DOM evidence', () => {
  const plan = planStep({ number: 8, action: 'Comprobar el precio.', expected: 'Se muestra exactamente $15.99.' });
  assert.deepEqual(plan.assertions.map((item) => item.expected), ['15.99']);
});

test('removes sentence punctuation from URL expectations', () => {
  const plan = planStep({ number: 9, expected: 'La URL termina en /inventory.html.' });
  assert.equal(plan.assertions[0]?.expected, '/inventory.html');
});
