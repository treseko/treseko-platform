import { describe, expect, it } from 'vitest';
import { preferRecordedBaseUrl } from './automationScriptUtils';

describe('preferRecordedBaseUrl', () => {
  it('uses the recorded origin instead of an environment override from older Flow scripts', () => {
    const script = 'const baseUrl = variables.base_url || variables.BASE_URL || "https://the-internet.herokuapp.com";\nawait page.goto(new URL("/", baseUrl).toString());';
    expect(preferRecordedBaseUrl(script)).toBe('const baseUrl = "https://the-internet.herokuapp.com";\nawait page.goto(new URL("/", baseUrl).toString());');
  });

  it('leaves scripts without the legacy generated declaration unchanged', () => {
    const script = 'const baseUrl = variables.base_url; await page.goto(baseUrl);';
    expect(preferRecordedBaseUrl(script)).toBe(script);
  });
});
