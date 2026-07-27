import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedAIAction } from './agent-driver.ts';
test('only permits browser actions from the normalized contract', () => { assert.equal(isAllowedAIAction({ action: 'click', target_ref: 'button:login' }), true); assert.equal(isAllowedAIAction({ action: 'shell', value: 'rm -rf' }), false); });
