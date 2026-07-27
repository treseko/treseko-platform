import assert from 'node:assert/strict';
import test from 'node:test';
import { interpretStepData, valueForRole } from './context-data-interpreter.ts';

test('normaliza pares con igual y dos puntos sin conservar la clave en el valor', () => {
  const result = interpretStepData('username=standard_user; password: secret_sauce');
  assert.equal(valueForRole(result, ['usuario']), 'standard_user');
  assert.equal(valueForRole(result, ['clave']), 'secret_sauce');
  assert.equal(result.inputs.find((item) => item.role === 'password')?.masked, true);
});

test('resuelve aliases de contexto solo cuando el paso no los define', () => {
  const result = interpretStepData('', { variables: { correo: 'qa@example.invalid' } });
  assert.equal(valueForRole(result, ['email']), 'qa@example.invalid');
  assert.equal(result.inputs[0]?.source, 'variables');
});

test('acepta JSON y no inventa valores para texto no estructurado', () => {
  const json = interpretStepData('{"usuario":"demo","clave":"secret"}');
  assert.equal(valueForRole(json, ['username']), 'demo');
  const unknown = interpretStepData('completar el formulario con los datos disponibles');
  assert.equal(unknown.inputs.length, 0);
  assert.equal(unknown.ambiguities.length, 1);
});
