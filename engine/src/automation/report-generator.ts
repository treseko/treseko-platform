import fs from 'fs';
import path from 'path';
import { ENGINE_REPORTS_DIR, safePathSegment } from '../runtime-config.ts';
import { updateGlobalIndex } from './report-global-index.ts';
import { updateSuiteIndex } from './report-suite-index.ts';
import { generateHtml } from './report-html.ts';

export interface ReportStep {
  step: number;
  action: string;
  reason: string;
  expectedResult?: string;
  actualResult?: string;
  screenshotPath: string;
  timestamp: string;
  attempts: number;
  dataUsed?: string;
  confidence: number;
  technicalDetails?: string;
  metrics?: {
    latencyMs: number;
    tokens: number;
    cost: number;
  };
  model?: string;
  guardApproved?: boolean;
  guardReason?: string;
}

export class ReportGenerator {
  private steps: ReportStep[] = [];
  private testLinkId: string;
  private suiteName: string;
  private task: string;
  private manualSteps?: string;
  private reportDir: string;
  private screenshotsDir: string;
  private suiteDir: string;
  private startTime: number;
  private finalStatus: string = 'PENDING';
  private finalReason: string = '';
  private finalConfidence: number = 0;
  private preConditions: string = 'Navegador abierto y URL inicial cargada.';
  private postConditions: string = 'Sesión finalizada y navegador cerrado.';
  private modelUsed: string = 'N/A';
  private totalTokens: number = 0;
  private totalCost: number = 0;

  constructor(task: string, testLinkId: string = 'N/A', suiteName: string = 'default', manualSteps?: string) {
    this.task = task;
    this.manualSteps = manualSteps;
    this.testLinkId = testLinkId;
    this.suiteName = suiteName;
    this.startTime = Date.now();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const runId = `${testLinkId}_${timestamp}`;

    this.suiteDir = path.join(ENGINE_REPORTS_DIR, safePathSegment(this.suiteName, 'suite'));
    this.reportDir = path.join(this.suiteDir, runId);
    this.screenshotsDir = path.join(this.reportDir, 'screenshots');

    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }
  }

  setPreConditions(cond: string) { this.preConditions = cond; }
  setPostConditions(cond: string) { this.postConditions = cond; }
  setModel(model: string) { this.modelUsed = model; }

  private formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
  }

  private sanitize(str: string): string {
    if (!str) return '';
    return str.toString().replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
  }

  setFinalStatus(status: string, reason: string, confidence: number = 0) {
    this.finalStatus = status;
    this.finalReason = this.sanitize(reason);
    this.finalConfidence = confidence;
  }

  addUsage(metrics?: any) {
    if (!metrics) return;
    this.totalTokens += metrics.totalTokens || metrics.tokens || 0;
    this.totalCost += metrics.estimatedCost || metrics.cost || 0;
  }

  private screenshotBufferFrom(value: any): Buffer {
    if (Buffer.isBuffer(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const raw = value.replace(/^data:image\/\w+;base64,/, '');
      try {
        return Buffer.from(raw, 'base64');
      } catch (_) {
        return Buffer.from('');
      }
    }
    return Buffer.from('');
  }

  addStep(
    step: number,
    action: string,
    reason: string,
    screenshotOrActual: Buffer | string,
    attemptsOrStatus: number | string = 1,
    dataUsedOrScreenshot?: string,
    confidenceOrDetails: number | string = 0,
    technicalDetails?: string,
    expectedResult?: string,
    actualResult?: string,
    metrics?: any,
    guard?: any
  ) {
    let screenshotBuffer: Buffer;
    let attempts = 1;
    let dataUsed: string | undefined;
    let confidence = 0;
    let details = technicalDetails;
    let expected = expectedResult;
    let actual = actualResult;

    if (Buffer.isBuffer(screenshotOrActual)) {
      screenshotBuffer = screenshotOrActual;
      attempts = typeof attemptsOrStatus === 'number' ? attemptsOrStatus : 1;
      dataUsed = dataUsedOrScreenshot;
      confidence = typeof confidenceOrDetails === 'number' ? confidenceOrDetails : 0;
    } else {
      // Legacy engine call shape: addStep(step, action, expected, actual, status, screenshotBase64, details)
      screenshotBuffer = this.screenshotBufferFrom(dataUsedOrScreenshot);
      expected = reason;
      actual = screenshotOrActual;
      details = typeof confidenceOrDetails === 'string' ? confidenceOrDetails : technicalDetails;
    }

    const screenshotName = `step_${step}.png`;
    const screenshotPath = path.join(this.screenshotsDir, screenshotName);

    fs.writeFileSync(screenshotPath, screenshotBuffer);

    if (metrics) {
      this.totalTokens += metrics.totalTokens || 0;
      this.totalCost += metrics.estimatedCost || 0;
    }

    this.steps.push({
      step,
      action,
      reason: this.sanitize(reason),
      expectedResult: expected ? this.sanitize(expected) : 'Acción ejecutada sin errores.',
      actualResult: actual ? this.sanitize(actual) : 'El sistema responde a la acción de forma estable.',
      screenshotPath: path.join('screenshots', screenshotName),
      timestamp: new Date().toLocaleTimeString(),
      attempts,
      dataUsed: dataUsed ? this.sanitize(dataUsed) : undefined,
      confidence,
      technicalDetails: details ? this.sanitize(details) : undefined,
      metrics: metrics ? {
        latencyMs: metrics.latencyMs,
        tokens: metrics.totalTokens,
        cost: metrics.estimatedCost
      } : undefined,
      model: this.modelUsed,
      guardApproved: guard ? guard.approved : true,
      guardReason: guard ? this.sanitize(guard.reason) : undefined
    });
  }

  generateHtml(duration: string, suiteData: any[]): string {
    return generateHtml(this, duration, suiteData)
  }

  private updateGlobalIndex() {
    return updateGlobalIndex(this)
  }

  private updateSuiteIndex(duration: string): any[] {
    return updateSuiteIndex(this, duration)
  }

  generate() {
    const endTime = Date.now();
    const durationSeconds = (endTime - this.startTime) / 1000;
    const durationStr = this.formatDuration(durationSeconds);
    const updatedSuiteData = this.updateSuiteIndex(durationStr);
    const html = this.generateHtml(durationStr, updatedSuiteData);
    const filePath = path.join(this.reportDir, 'index.html');
    fs.writeFileSync(filePath, html);
    console.log(`\n📄 Reporte generado: ${path.resolve(filePath)}`);
    return filePath;
  }

  save() {
    return this.generate();
  }
}
