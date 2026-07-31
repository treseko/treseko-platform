import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import test, { after, before } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { runQaSteps } from './step-runner.ts';
import type { QAEngineStep } from './action-types.ts';

const fixtureUrl = 'http://127.0.0.1:19221';
const fixtureDirectory = fileURLToPath(new URL('./fixtures/ai-agent-campaign/', import.meta.url));
const fixtureServer = `${fixtureDirectory}fixture-server.mjs`;
const campaignCases = `${fixtureDirectory}cases.json`;
let fixture: ChildProcess;
let browser: Browser;
let context: BrowserContext;

async function waitForFixture(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${fixtureUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('El fixture de campana no inicio');
}

before(async () => {
  fixture = spawn(process.execPath, [fixtureServer], {
    cwd: process.cwd(),
    env: { ...process.env, AI_CAMPAIGN_FIXTURE_PORT: '19221' },
    stdio: 'ignore',
  });
  await waitForFixture();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  await context.addInitScript(() => {
    (globalThis as any).__name = (globalThis as any).__name || ((fn: unknown) => fn);
  });
});

after(async () => {
  await browser?.close();
  fixture?.kill('SIGTERM');
});

test('los 25 casos tienen un resultado determinista sin delegar hechos observables al LLM', async () => {
  const raw = await readFile(campaignCases, 'utf8');
  const cases = JSON.parse(raw) as Array<{
    code: string;
    title: string;
    oracle: 'PASO' | 'FALLO';
    steps: Array<[string, string, string]>;
  }>;
  const mismatches: string[] = [];

  for (const definition of cases) {
    const page = await context.newPage();
    const steps: QAEngineStep[] = definition.steps.map((item, index) => ({
      number: index + 1,
      action: item[0],
      data: item[1].replaceAll('{{BASE_URL}}', fixtureUrl),
      expected: item[2],
    }));
    const forbiddenAi = {
      planStepAction: async () => {
        throw new Error(`El caso ${definition.code} delego una accion determinista al LLM`);
      },
      sendAgentExecutionResult: async () => undefined,
    };
    try {
      const result = await runQaSteps(page, forbiddenAi as any, steps, {
        executionId: `deterministic-${definition.code}`,
        task: `${definition.code} ${definition.title}`,
        maxAttempts: 1,
      });
      const actual = result.steps.length === steps.length && result.steps.every((step) => step.status === 'PASO')
        ? 'PASO'
        : result.steps.some((step) => step.status === 'FALLO') ? 'FALLO' : 'BLOQUEADO';
      if (actual !== definition.oracle) {
        mismatches.push(`${definition.code}: esperado ${definition.oracle}, obtenido ${actual}; ${result.errors.join(' | ')}`);
      }
    } catch (error: any) {
      mismatches.push(`${definition.code}: ${error.message}`);
    } finally {
      await page.close();
    }
  }

  assert.deepEqual(mismatches, []);
});
