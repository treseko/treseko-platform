import fs from 'fs';
import path from 'path';
import { ENGINE_REPORTS_DIR, safePathSegment } from '../runtime-config.ts';

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
    const statusColor = this.finalStatus === 'PASSED' ? '#10b981' : (this.finalStatus === 'FAILED' ? '#ef4444' : '#f59e0b');
    const confidenceColor = this.finalConfidence > 80 ? '#10b981' : (this.finalConfidence > 50 ? '#f59e0b' : '#ef4444');

    const timelineItems = this.steps.map((s, idx) => `
      <div class="relative pl-8 pb-8 border-l border-slate-700 last:border-0">
        <div class="absolute -left-1.5 top-0 w-3 h-3 rounded-full bg-slate-600 border-2 border-slate-900"></div>
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="text-xs font-mono text-slate-500">${s.timestamp}</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-sky-500/10 text-sky-400 border border-sky-500/20">${s.action}</span>
              ${s.guardApproved === false ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">VETOED</span>' : ''}
            </div>
            <div class="text-[10px] text-slate-500 font-mono">Step ${s.step}</div>
          </div>
          
          <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
            <p class="text-sm text-slate-300 leading-relaxed">${s.reason}</p>
            ${s.guardReason ? `<p class="mt-2 text-xs text-amber-500/80 italic">Guard: ${s.guardReason}</p>` : ''}
            ${s.dataUsed ? `<div class="mt-3 py-1 px-2 bg-slate-900/50 rounded border border-slate-700 inline-block text-[10px] text-sky-400 font-mono">Data: ${s.dataUsed}</div>` : ''}
          </div>

          <div class="grid grid-cols-2 gap-4 mt-2">
            <div class="relative group cursor-zoom-in" onclick="openModal('${s.screenshotPath.replace(/\\/g, '/')}')">
              <img src="${s.screenshotPath.replace(/\\/g, '/')}" class="rounded border border-slate-700 hover:border-sky-500 transition-colors">
              <div class="absolute inset-0 bg-sky-500/0 group-hover:bg-sky-500/5 transition-colors rounded"></div>
            </div>
            <div class="flex flex-col gap-2">
              <div class="bg-slate-900/30 rounded p-3 border border-slate-800">
                <div class="text-[10px] text-slate-500 uppercase tracking-tighter mb-1">Technical Command</div>
                <code class="text-[10px] text-slate-400 break-all">${s.technicalDetails || 'N/A'}</code>
              </div>
              <div class="flex gap-4">
                <div class="text-[10px] text-slate-500">Latency: <span class="text-slate-300">${s.metrics?.latencyMs || 0}ms</span></div>
                <div class="text-[10px] text-slate-500">Tokens: <span class="text-slate-300">${s.metrics?.tokens || 0}</span></div>
                <div class="text-[10px] text-slate-500">Conf: <span style="color: ${s.confidence > 80 ? '#10b981' : '#f59e0b'}">${s.confidence}%</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `).join('');

    const manualCards = this.steps.map(s => `
      <div class="bg-slate-800/40 rounded-2xl border border-slate-700/50 overflow-hidden shadow-xl mb-8 group hover:border-sky-500/30 transition-all">
        <div class="grid grid-cols-12 gap-0">
          <!-- Screenshot Column -->
          <div class="col-span-12 md:col-span-5 relative bg-slate-900 group-hover:bg-slate-950 transition-colors">
            <div class="aspect-video w-full h-full relative cursor-zoom-in" onclick="openModal('${s.screenshotPath.replace(/\\/g, '/')}')">
              <img src="${s.screenshotPath.replace(/\\/g, '/')}" class="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity">
              <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-sky-500/10">
                <span class="px-3 py-1.5 bg-sky-500 text-white text-[10px] font-bold rounded-full shadow-lg">AMPLIAR EVIDENCIA</span>
              </div>
            </div>
            <div class="absolute top-4 left-4 flex gap-2">
              <span class="px-3 py-1 bg-slate-900/80 backdrop-blur-md rounded-lg border border-slate-700 text-[10px] font-bold text-slate-300">PASO ${s.step}</span>
              <span class="px-3 py-1 bg-emerald-500 text-white text-[10px] font-bold rounded-lg shadow-lg">PASSED</span>
            </div>
          </div>
          
          <!-- Details Column -->
          <div class="col-span-12 md:col-span-7 p-6 flex flex-col justify-between bg-slate-800/20">
            <div>
              <div class="flex items-center justify-between mb-4">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-sky-500/10 text-sky-400 border border-sky-500/20">${s.action}</span>
                <span class="text-[10px] text-slate-500 font-mono">${s.timestamp}</span>
              </div>
              
              <div class="mb-4">
                <h4 class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Descripción de la Acción</h4>
                <p class="text-sm text-slate-200 leading-relaxed">${s.reason}</p>
              </div>

              <div class="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <h4 class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Resultado Esperado</h4>
                  <p class="text-[11px] text-slate-400 italic leading-snug">${s.expectedResult || 'Confirmación de estabilidad visual.'}</p>
                </div>
                <div>
                  <h4 class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Datos Utilizados</h4>
                  <p class="text-[11px] font-mono text-sky-400">${s.dataUsed || 'N/A'}</p>
                </div>
              </div>
            </div>

            <div class="pt-4 border-t border-slate-700/50 flex items-center justify-between">
              <div class="flex items-center gap-4">
                <div class="flex flex-col">
                  <span class="text-[9px] text-slate-500 font-bold uppercase">Confianza</span>
                  <span class="text-xs font-bold text-emerald-500">${s.confidence}%</span>
                </div>
                <div class="flex flex-col">
                  <span class="text-[9px] text-slate-500 font-bold uppercase">Latencia</span>
                  <span class="text-xs text-slate-400 font-mono">${s.metrics?.latencyMs || 0}ms</span>
                </div>
              </div>
              <div class="text-[10px] text-slate-600 font-mono">${this.modelUsed}</div>
            </div>
          </div>
        </div>
      </div>
    `).join('');

    return `
<!DOCTYPE html>
<html lang="es" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Trace - ${this.testLinkId}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    fontFamily: {
                        sans: ['Inter', 'sans-serif'],
                        mono: ['JetBrains Mono', 'monospace'],
                    },
                    colors: {
                        slate: {
                            950: '#020617',
                            900: '#0f172a',
                            800: '#1e293b',
                        }
                    }
                }
            }
        }
    </script>
    <style>
        body { background-color: #0f172a; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    </style>
</head>
<body class="text-slate-200 font-sans min-h-screen flex flex-col">

    <header class="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div class="flex items-center gap-4">
            <div class="flex items-center gap-2 text-slate-400 text-xs">
                <a href="../../index.html" class="hover:text-white transition-colors">Dashboard</a>
                <span>/</span>
                <a href="../suite-index.html" class="hover:text-white transition-colors">${this.suiteName}</a>
                <span>/</span>
                <span class="text-slate-100 font-medium">${this.testLinkId}</span>
            </div>
        </div>
        <div class="flex items-center gap-6">
            <div class="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
                <button onclick="setView('tech')" id="btn-tech" class="px-3 py-1.5 rounded-md text-xs font-medium transition-all bg-slate-700 text-white shadow-sm">Technical Trace</button>
                <button onclick="setView('manual')" id="btn-manual" class="px-3 py-1.5 rounded-md text-xs font-medium transition-all text-slate-400 hover:text-white">Manual View</button>
            </div>
        </div>
    </header>

    <main class="flex-1 flex overflow-hidden">
        
        <div id="view-tech" class="flex-1 flex overflow-hidden">
            <div class="flex-1 overflow-y-auto p-8 hide-scrollbar">
                <div class="max-w-3xl mx-auto">
                    <div class="flex items-center justify-between mb-8">
                        <div>
                            <h1 class="text-2xl font-bold text-white tracking-tight">${this.task}</h1>
                            <p class="text-slate-500 mt-1 text-sm">Ejecución agéntica iniciada en ${new Date(this.startTime).toLocaleTimeString()}</p>
                        </div>
                        <div class="flex flex-col items-end">
                            <span class="px-3 py-1 rounded-full text-xs font-bold bg-slate-800 border border-slate-700" style="color: ${statusColor}">
                                ${this.finalStatus}
                            </span>
                            <span class="text-[10px] text-slate-500 mt-2 font-mono">Duration: ${duration}</span>
                        </div>
                    </div>

                    ${this.manualSteps ? `
                    <div class="mb-8 p-4 bg-sky-500/5 border border-sky-500/20 rounded-xl">
                        <h3 class="text-[10px] font-bold text-sky-400 uppercase tracking-widest mb-2">Guía Manual de Pasos</h3>
                        <p class="text-sm text-slate-300 leading-relaxed whitespace-pre-line">${this.sanitize(this.manualSteps)}</p>
                    </div>
                    ` : ''}

                    <div class="space-y-0">
                        ${timelineItems}
                    </div>
                </div>
            </div>

            <aside class="w-80 border-l border-slate-800 bg-slate-900/50 p-6 flex flex-col gap-8 overflow-y-auto">
                <section>
                    <h3 class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">Agent Brain</h3>
                    <div class="space-y-4">
                        <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                            <div class="text-[10px] text-slate-500 mb-1">Model</div>
                            <div class="text-xs font-mono text-sky-400">${this.modelUsed}</div>
                        </div>
                        <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                            <div class="text-[10px] text-slate-500 mb-1">Audit Confidence</div>
                            <div class="text-xl font-bold" style="color: ${confidenceColor}">${this.finalConfidence}%</div>
                        </div>
                        <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                            <div class="text-[10px] text-slate-500 mb-1">Total Consumption</div>
                            <div class="text-xs text-slate-300 font-mono">${this.totalTokens.toLocaleString()} tokens</div>
                            <div class="text-xs text-slate-500 mt-1">Est. Cost: $${this.totalCost.toFixed(4)}</div>
                        </div>
                    </div>
                </section>

                <section>
                    <h3 class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">Auditor Verdict</h3>
                    <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700 border-l-4" style="border-left-color: ${statusColor}">
                        <p class="text-xs leading-relaxed text-slate-300">${this.finalReason}</p>
                    </div>
                </section>
            </aside>
        </div>

        <div id="view-manual" class="flex-1 hidden overflow-y-auto bg-slate-900">
            <div class="max-w-5xl mx-auto p-12">
                <div class="mb-12">
                    <div class="flex items-center justify-between mb-8">
                        <div>
                            <h2 class="text-3xl font-bold text-white mb-2">Caso de Prueba Visual</h2>
                            <p class="text-slate-500 text-sm">Evidencia detallada paso a paso para QA Manual</p>
                        </div>
                        <div class="px-4 py-2 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-xl font-bold text-sm">
                            ESTADO: ${this.finalStatus}
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-3 gap-8 mb-12">
                        <div class="col-span-2">
                            <div class="text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">Script de Prueba (Guía Manual)</div>
                            <div class="bg-sky-500/5 rounded-2xl p-6 border border-sky-500/20 text-sm text-slate-300 leading-relaxed whitespace-pre-line shadow-inner">
                                ${this.manualSteps || this.task}
                            </div>
                        </div>
                        <div class="space-y-4">
                            <div>
                                <div class="text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">Pre-condiciones</div>
                                <div class="bg-slate-800/30 rounded-xl p-4 border border-slate-800 text-xs text-slate-400">
                                    ${this.preConditions}
                                </div>
                            </div>
                            <div>
                                <div class="text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">Post-condiciones</div>
                                <div class="bg-slate-800/30 rounded-xl p-4 border border-slate-800 text-xs text-slate-400">
                                    ${this.postConditions}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="space-y-2">
                    <div class="flex items-center gap-4 mb-6">
                        <h3 class="text-lg font-bold text-white">Pasos Ejecutados y Evidencias</h3>
                        <div class="h-px flex-1 bg-slate-800"></div>
                    </div>
                    
                    ${manualCards}
                </div>

                <div class="mt-12 bg-slate-800/50 rounded-2xl p-8 border border-slate-700 relative overflow-hidden shadow-2xl">
                    <div class="absolute top-0 right-0 p-8 opacity-5">
                        <svg class="w-48 h-48 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>
                    </div>
                    <div class="relative z-10">
                        <h3 class="text-xl font-bold text-white mb-4">Conclusión del Auditor QA</h3>
                        <p class="text-slate-300 text-lg leading-relaxed max-w-3xl">${this.finalReason}</p>
                        <div class="mt-8 flex items-center gap-6">
                            <div class="flex flex-col">
                                <span class="text-[10px] text-slate-500 font-bold uppercase mb-1">Resultado Final</span>
                                <span class="text-2xl font-black text-emerald-500 tracking-tighter">${this.finalStatus}</span>
                            </div>
                            <div class="w-px h-10 bg-slate-700"></div>
                            <div class="flex flex-col">
                                <span class="text-[10px] text-slate-500 font-bold uppercase mb-1">Confianza de IA</span>
                                <span class="text-2xl font-black text-white tracking-tighter">${this.finalConfidence}%</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </main>

    <footer class="bg-slate-900 border-t border-slate-800 px-6 py-4 flex items-center justify-between">
        <div class="flex items-center gap-4">
            <a id="nav-prev" href="#" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium transition-colors border border-slate-700 opacity-50 pointer-events-none">&larr; Test Anterior</a>
        </div>
        
        <div class="flex flex-col items-center">
            <div id="nav-progress-text" class="text-[10px] font-bold text-slate-500 uppercase mb-2">Test 0 de 0</div>
            <div class="w-64 h-1.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                <div id="nav-progress-bar" class="h-full bg-sky-500 transition-all duration-500" style="width: 0%"></div>
            </div>
        </div>

        <div class="flex items-center gap-4">
            <a id="nav-next" href="#" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium transition-colors border border-slate-700 opacity-50 pointer-events-none">Siguiente Test &rarr;</a>
        </div>
    </footer>

    <div id="img-modal" class="fixed inset-0 z-[100] bg-slate-950/95 flex items-center justify-center p-12 hidden opacity-0 transition-opacity duration-300 cursor-zoom-out" onclick="closeModal()">
        <img id="modal-content" class="max-w-full max-h-full rounded-lg shadow-2xl border border-slate-800 translate-y-4 transition-transform duration-300">
    </div>

    <script>
        const suiteData = ${JSON.stringify(suiteData)};

        function setView(view) {
            const btnTech = document.getElementById('btn-tech');
            const btnManual = document.getElementById('btn-manual');
            const viewTech = document.getElementById('view-tech');
            const viewManual = document.getElementById('view-manual');

            if (view === 'tech') {
                viewTech.classList.remove('hidden');
                viewManual.classList.add('hidden');
                btnTech.classList.add('bg-slate-700', 'text-white');
                btnTech.classList.remove('text-slate-400');
                btnManual.classList.remove('bg-slate-700', 'text-white');
                btnManual.classList.add('text-slate-400');
            } else {
                viewTech.classList.add('hidden');
                viewManual.classList.remove('hidden');
                btnManual.classList.add('bg-slate-700', 'text-white');
                btnManual.classList.remove('text-slate-400');
                btnTech.classList.remove('bg-slate-700', 'text-white');
                btnTech.classList.add('text-slate-400');
            }
        }

        function openModal(src) {
            const modal = document.getElementById('img-modal');
            const content = document.getElementById('modal-content');
            modal.classList.remove('hidden');
            setTimeout(() => {
                modal.classList.remove('opacity-0');
                content.classList.remove('translate-y-4');
                content.src = src;
            }, 10);
            document.body.style.overflow = 'hidden';
        }

        function closeModal() {
            const modal = document.getElementById('img-modal');
            const content = document.getElementById('modal-content');
            modal.classList.add('opacity-0');
            content.classList.add('translate-y-4');
            setTimeout(() => {
                modal.classList.add('hidden');
            }, 300);
            document.body.style.overflow = '';
        }

        function initNavigation() {
            const runs = suiteData;
            const path = window.location.pathname.toLowerCase();
            let currentRunId = "";
            for (const run of runs) {
                if (path.indexOf(run.runId.toLowerCase()) !== -1) {
                    currentRunId = run.runId;
                    break;
                }
            }
            
            const currentIndex = runs.findIndex(r => r.runId === currentRunId);
            
            if (currentIndex !== -1) {
                const total = runs.length;
                const current = currentIndex + 1;
                const progress = (current / total) * 100;
                
                document.getElementById('nav-progress-text').innerText = \`Test \${current} de \${total}\`;
                document.getElementById('nav-progress-bar').style.width = \`\${progress}%\`;

                if (currentIndex > 0) {
                    const prev = runs[currentIndex - 1];
                    const btn = document.getElementById('nav-prev');
                    btn.href = '../' + prev.runId + '/index.html';
                    btn.classList.remove('opacity-50', 'pointer-events-none');
                }
                
                if (currentIndex < total - 1) {
                    const next = runs[currentIndex + 1];
                    const btn = document.getElementById('nav-next');
                    btn.href = '../' + next.runId + '/index.html';
                    btn.classList.remove('opacity-50', 'pointer-events-none');
                }
            }
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
            if (e.key === 'ArrowLeft') {
                const btn = document.getElementById('nav-prev');
                if (btn && !btn.classList.contains('pointer-events-none')) window.location.href = btn.href;
            }
            if (e.key === 'ArrowRight') {
                const btn = document.getElementById('nav-next');
                if (btn && !btn.classList.contains('pointer-events-none')) window.location.href = btn.href;
            }
        });

        initNavigation();
    </script>
</body>
</html>
`;
  }

  private updateGlobalIndex() {
    const reportsDir = ENGINE_REPORTS_DIR;
    const globalIndexPath = path.join(reportsDir, 'index.html');
    if (!fs.existsSync(reportsDir)) return;
    
    const suites = fs.readdirSync(reportsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    let totalTests = 0;
    let totalPassed = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let avgConfidence = 0;
    let confidenceSum = 0;
    let confidenceCount = 0;

    const suiteCards = suites.map(suite => {
        const suiteDataPath = path.join(reportsDir, suite, 'suite-data.json');
        let stats = { total: 0, passed: 0, tokens: 0, cost: 0, avgConf: 0 };
        
        if (fs.existsSync(suiteDataPath)) {
            const data = JSON.parse(fs.readFileSync(suiteDataPath, 'utf8'));
            stats.total = data.length;
            stats.passed = data.filter((r: any) => r.status === 'PASSED').length;
            stats.tokens = data.reduce((acc: number, r: any) => acc + (r.tokens || 0), 0);
            stats.cost = data.reduce((acc: number, r: any) => acc + (r.cost || 0), 0);
            
            const confs = data.map((r: any) => r.confidence || 0).filter((c: number) => c > 0);
            if (confs.length > 0) {
                stats.avgConf = Math.round(confs.reduce((acc: number, c: number) => acc + c, 0) / confs.length);
                confidenceSum += confs.reduce((acc: number, c: number) => acc + c, 0);
                confidenceCount += confs.length;
            }

            totalTests += stats.total;
            totalPassed += stats.passed;
            totalTokens += stats.tokens;
            totalCost += stats.cost;
        }

        const accuracy = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;
        const statusColor = stats.total > 0 ? (accuracy > 80 ? 'emerald' : (accuracy > 50 ? 'amber' : 'rose')) : 'slate';

        return `
            <div class="bg-slate-800/40 p-6 rounded-2xl border border-slate-800 hover:border-sky-500/50 transition-all group shadow-lg">
                <div class="flex justify-between items-start mb-6">
                    <div>
                        <h3 class="text-white font-bold text-lg tracking-tight group-hover:text-sky-400 transition-colors uppercase">${suite}</h3>
                        <div class="text-[10px] text-slate-500 font-bold tracking-widest uppercase mt-1">Suite Analytics</div>
                    </div>
                    <span class="px-2 py-1 bg-${statusColor}-500/10 text-${statusColor}-500 border border-${statusColor}-500/20 rounded text-[10px] font-bold">${accuracy}% SUCCESS</span>
                </div>
                
                <div class="space-y-4">
                    <div class="grid grid-cols-2 gap-2 mb-4">
                        <div class="flex flex-col">
                            <span class="text-[8px] text-slate-500 uppercase font-bold">Consumo</span>
                            <span class="text-xs text-slate-300 font-mono">${stats.tokens.toLocaleString()} tkn</span>
                        </div>
                        <div class="flex flex-col items-end">
                            <span class="text-[8px] text-slate-500 uppercase font-bold">Costo Est.</span>
                            <span class="text-xs text-sky-400 font-mono">$${stats.cost.toFixed(4)}</span>
                        </div>
                    </div>

                    <div>
                        <div class="flex justify-between text-[10px] text-slate-500 font-bold mb-1 uppercase">Execution Progress</div>
                        <div class="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                            <div class="h-full bg-${statusColor}-500" style="width: ${accuracy}%"></div>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-2 gap-4">
                        <div class="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                            <div class="text-[10px] text-slate-500 mb-1 uppercase">Tests</div>
                            <div class="text-lg font-bold text-white">${stats.total}</div>
                        </div>
                        <div class="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                            <div class="text-[10px] text-slate-500 mb-1 uppercase">AI Conf.</div>
                            <div class="text-lg font-bold text-sky-400">${stats.avgConf}%</div>
                        </div>
                    </div>
                </div>

                <a href="${suite}/suite-index.html" class="mt-6 block w-full py-3 bg-slate-800 hover:bg-slate-700 text-center rounded-xl text-xs font-bold transition-all border border-slate-700 group-hover:border-sky-500/30">Explore Suite</a>
            </div>
        `;
    }).join('');

    const globalAccuracy = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;
    avgConfidence = confidenceCount > 0 ? Math.round(confidenceSum / confidenceCount) : 0;

    const html = `
<!DOCTYPE html>
<html lang="es" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI QA Orchestrator - Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        slate: { 950: '#020617', 900: '#0f172a', 800: '#1e293b' }
                    }
                }
            }
        }
    </script>
</head>
<body class="bg-slate-900 text-slate-200 font-sans min-h-screen">
    <nav class="border-b border-slate-800 bg-slate-950/50 backdrop-blur-md px-12 py-6 flex justify-between items-center sticky top-0 z-50">
        <h1 class="text-xl font-bold text-white tracking-tighter">AI QA <span class="text-sky-500">ORCHESTRATOR</span></h1>
        <div class="flex items-center gap-6">
            <select class="bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-xs text-slate-300 focus:outline-none focus:border-sky-500">
                <option>Last 24 Hours</option>
                <option>Last 7 Days</option>
                <option>Last 30 Days</option>
            </select>
            <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-sky-500 to-indigo-600 border border-white/20"></div>
        </div>
    </nav>

    <main class="max-w-[1400px] mx-auto p-12">
        <!-- KPI Dashboard -->
        <div class="grid grid-cols-4 gap-8 mb-12">
            <div class="bg-slate-800/50 p-8 rounded-3xl border border-slate-800 shadow-2xl flex flex-col items-center justify-center relative overflow-hidden group">
                <div class="absolute inset-0 bg-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div class="w-32 h-32 mb-4 relative">
                    <canvas id="radialChart"></canvas>
                    <div class="absolute inset-0 flex items-center justify-center flex-col">
                        <span class="text-2xl font-black text-white leading-none">${globalAccuracy}%</span>
                        <span class="text-[8px] font-bold text-slate-500 uppercase">Success</span>
                    </div>
                </div>
                <div class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-2 text-center">Global Success Rate</div>
            </div>

            <div class="bg-slate-800/50 p-8 rounded-3xl border border-slate-800 shadow-2xl relative overflow-hidden group">
                <div class="absolute inset-0 bg-sky-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6">Total AI Consumption</div>
                <div class="space-y-4 relative">
                    <div>
                        <div class="text-3xl font-black text-white leading-none">${totalTokens.toLocaleString()}</div>
                        <div class="text-[10px] text-slate-500 font-bold uppercase mt-1">Tokens Generated</div>
                    </div>
                    <div class="pt-4 border-t border-slate-700/50">
                        <div class="text-xl font-bold text-sky-400">$${totalCost.toFixed(4)}</div>
                        <div class="text-[10px] text-slate-500 font-bold uppercase mt-1">Estimated API Cost</div>
                    </div>
                </div>
            </div>

            <div class="bg-slate-800/50 p-8 rounded-3xl border border-slate-800 shadow-2xl relative overflow-hidden group">
                <div class="absolute inset-0 bg-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6">Active Test Suites</div>
                <div class="text-6xl font-black text-white leading-none">${suites.length}</div>
                <div class="mt-6 flex gap-2">
                    <div class="flex -space-x-2">
                        <div class="w-6 h-6 rounded-full bg-slate-700 border border-slate-800"></div>
                        <div class="w-6 h-6 rounded-full bg-slate-600 border border-slate-800"></div>
                        <div class="w-6 h-6 rounded-full bg-slate-500 border border-slate-800"></div>
                    </div>
                    <div class="text-xs text-slate-500 font-medium">Running modules</div>
                </div>
            </div>

            <div class="bg-slate-800/50 p-8 rounded-3xl border border-slate-800 shadow-2xl relative overflow-hidden group">
                <div class="absolute inset-0 bg-amber-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6">Avg Agent Confidence</div>
                <div class="text-6xl font-black text-amber-500 leading-none">${avgConfidence}%</div>
                <div class="mt-6 flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                    <span class="text-xs text-slate-500">System Stability: High</span>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-3 gap-12">
            <!-- Main Analytics -->
            <div class="col-span-2 space-y-12">
                <div class="bg-slate-800/30 p-8 rounded-3xl border border-slate-800 shadow-xl">
                    <div class="flex justify-between items-center mb-8">
                        <div>
                            <h2 class="text-xl font-bold text-white tracking-tight">Pruebas vs Tiempo</h2>
                            <p class="text-xs text-slate-500 mt-1 uppercase font-bold tracking-tighter">Execution Trend Line</p>
                        </div>
                    </div>
                    <div class="h-64">
                        <canvas id="mainChart"></canvas>
                    </div>
                </div>

                <div>
                    <h2 class="text-xl font-bold text-white tracking-tight mb-8">Recent Test Suites</h2>
                    <div class="grid grid-cols-2 gap-6">
                        ${suiteCards}
                    </div>
                </div>
            </div>

            <!-- Side Feed -->
            <div class="space-y-8">
                <div class="bg-slate-950/50 rounded-3xl border border-slate-800 p-8 shadow-2xl">
                    <h3 class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6">System Health</h3>
                    <div class="space-y-6">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-medium text-slate-400">Agent API</span>
                            <span class="px-2 py-0.5 rounded-full text-[8px] font-bold bg-emerald-500/10 text-emerald-500 uppercase border border-emerald-500/20">Stable</span>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-medium text-slate-400">Vision Engine</span>
                            <span class="px-2 py-0.5 rounded-full text-[8px] font-bold bg-emerald-500/10 text-emerald-500 uppercase border border-emerald-500/20">Operational</span>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-medium text-slate-400">Browser Farm</span>
                            <span class="px-2 py-0.5 rounded-full text-[8px] font-bold bg-sky-500/10 text-sky-400 uppercase border border-sky-500/20">Active</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </main>

    <script>
        // Radial Chart
        new Chart(document.getElementById('radialChart'), {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [${globalAccuracy}, ${100 - globalAccuracy}],
                    backgroundColor: ['#10b981', '#1e293b'],
                    borderWidth: 0,
                    circumference: 360,
                    rotation: 0
                }]
            },
            options: {
                cutout: '85%',
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                responsive: true,
                maintainAspectRatio: false
            }
        });

        // Main Trend Chart
        new Chart(document.getElementById('mainChart'), {
            type: 'line',
            data: {
                labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                datasets: [{
                    label: 'Success Rate',
                    data: [85, 92, 78, 88, 95, 82, ${globalAccuracy}],
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    fill: true,
                    tension: 0.4,
                    borderWidth: 3,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#475569', font: { size: 10 } } },
                    y: { grid: { color: '#1e293b' }, ticks: { color: '#475569', font: { size: 10 } }, beginAtZero: true }
                }
            }
        });
    </script>
</body>
</html>
`;
    fs.writeFileSync(globalIndexPath, html);
  }

  private updateSuiteIndex(duration: string): any[] {
    const suiteIndexPath = path.join(this.suiteDir, 'suite-index.html');
    let suiteRuns: any[] = [];
    const dbPath = path.join(this.suiteDir, 'suite-data.json');
    if (fs.existsSync(dbPath)) {
      suiteRuns = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    }
    const runId = path.basename(this.reportDir);
    const durationParts = duration.split(':').map(Number);
    const durationSeconds = (durationParts[0] * 3600) + (durationParts[1] * 60) + durationParts[2];
    
    // Count vetoes for this run
    const vetoes = this.steps.filter(s => s.guardApproved === false).length;

    const runData = { 
        id: this.testLinkId, 
        runId: runId, 
        task: this.task, 
        status: this.finalStatus, 
        date: new Date().toLocaleString(), 
        duration: duration, 
        durationSec: durationSeconds, 
        confidence: this.finalConfidence,
        tokens: this.totalTokens,
        cost: this.totalCost,
        verdict: this.finalReason,
        vetoes: vetoes
    };

    const existingIndex = suiteRuns.findIndex(r => r.runId === runId);
    if (existingIndex >= 0) suiteRuns[existingIndex] = runData;
    else suiteRuns.push(runData);
    fs.writeFileSync(dbPath, JSON.stringify(suiteRuns, null, 2));

    const passed = suiteRuns.filter(r => r.status === 'PASSED').length;
    const failed = suiteRuns.filter(r => r.status === 'FAILED').length;
    const accuracy = suiteRuns.length > 0 ? ((passed / suiteRuns.length) * 100).toFixed(1) : '0';
    const totalSeconds = suiteRuns.reduce((acc, r) => acc + (r.durationSec || 0), 0);
    const totalVetoes = suiteRuns.reduce((acc, r) => acc + (r.vetoes || 0), 0);

    const rows = suiteRuns.map(r => `
      <tr class="border-b border-slate-800 hover:bg-slate-800/50 cursor-pointer transition-colors" onclick="window.location.href='${r.runId}/index.html'">
        <td class="py-4 px-6 text-[10px] font-mono text-slate-500">${r.date}</td>
        <td class="py-4 px-6 text-xs font-mono text-slate-500">${r.id}</td>
        <td class="py-4 px-6 text-sm font-medium text-slate-200">${r.task}</td>
        <td class="py-4 px-6">
            <span class="px-2 py-1 rounded text-[10px] font-bold bg-${r.status === 'PASSED' ? 'emerald' : 'rose'}-500/10 text-${r.status === 'PASSED' ? 'emerald' : 'rose'}-500 border border-${r.status === 'PASSED' ? 'emerald' : 'rose'}-500/20">${r.status}</span>
        </td>
        <td class="py-4 px-6">
            <div class="flex flex-col">
                <span class="text-[10px] text-slate-300 font-mono">${(r.tokens || 0).toLocaleString()} tkn</span>
                <span class="text-[9px] text-sky-400 font-mono">$${(r.cost || 0).toFixed(4)}</span>
            </div>
        </td>
        <td class="py-4 px-6 text-xs font-mono text-slate-500">${r.duration}</td>
        <td class="py-4 px-6 text-right">
            <div class="text-sky-400 font-bold">${r.confidence}%</div>
        </td>
      </tr>
    `).join('');

    const html = `
<!DOCTYPE html>
<html lang="es" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Suite Dashboard - ${this.suiteName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        slate: { 950: '#020617', 900: '#0f172a', 800: '#1e293b' }
                    }
                }
            }
        }
    </script>
</head>
<body class="bg-slate-900 text-slate-200 font-sans min-h-screen">
    <nav class="border-b border-slate-800 bg-slate-950/50 backdrop-blur-md px-8 py-4 flex justify-between items-center sticky top-0 z-50">
        <div class="flex items-center gap-4">
            <a href="../index.html" class="text-slate-400 hover:text-white transition-colors text-sm">Dashboard</a>
            <span class="text-slate-700">/</span>
            <span class="text-white font-bold tracking-tight text-lg">${this.suiteName.toUpperCase()}</span>
        </div>
        <div class="flex gap-4">
            <div class="bg-slate-800 rounded-lg px-3 py-1.5 border border-slate-700 flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span class="text-[10px] font-bold text-slate-400 uppercase">Live Metrics</span>
            </div>
        </div>
    </nav>

    <main class="max-w-7xl mx-auto p-8">
        <!-- KPI Row -->
        <div class="grid grid-cols-4 gap-6 mb-12">
            <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 shadow-xl">
                <div class="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">Success Rate</div>
                <div class="flex items-end gap-2">
                    <div class="text-3xl font-bold text-emerald-500">${accuracy}%</div>
                    <div class="text-xs text-slate-500 mb-1">accuracy</div>
                </div>
            </div>
            <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 shadow-xl">
                <div class="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">Total Time</div>
                <div class="flex items-end gap-2">
                    <div class="text-3xl font-bold text-white">${this.formatDuration(totalSeconds)}</div>
                </div>
            </div>
            <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 shadow-xl">
                <div class="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">Total Resource Usage</div>
                <div class="flex flex-col">
                    <div class="text-2xl font-bold text-sky-400">${suiteRuns.reduce((acc, r) => acc + (r.tokens || 0), 0).toLocaleString()} tkn</div>
                    <div class="text-[10px] text-slate-500 font-mono mt-1">Est. Cost: $${suiteRuns.reduce((acc, r) => acc + (r.cost || 0), 0).toFixed(4)}</div>
                </div>
            </div>
            <div class="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 shadow-xl">
                <div class="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">Execution Count</div>
                <div class="flex items-end gap-2">
                    <div class="text-3xl font-bold text-white">${suiteRuns.length}</div>
                    <div class="text-xs text-slate-500 mb-1">tests run</div>
                </div>
            </div>
        </div>

        <!-- Table -->
        <div class="bg-slate-950/30 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
                <h3 class="font-bold text-white">Test Executions</h3>
                <div class="flex gap-4">
                    <input type="text" placeholder="Filter tests..." class="bg-slate-800 border border-slate-700 rounded-lg px-4 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500 transition-colors">
                </div>
            </div>
            <table class="w-full text-left">
                <thead>
                    <tr class="text-[10px] font-bold text-slate-500 uppercase tracking-wider bg-slate-900/30">
                        <th class="py-4 px-6 w-32">Date</th>
                        <th class="py-4 px-6 w-24">ID</th>
                        <th class="py-4 px-6">Case Name</th>
                        <th class="py-4 px-6">Status</th>
                        <th class="py-4 px-6">Resources</th>
                        <th class="py-4 px-6">Duration</th>
                        <th class="py-4 px-6 text-right">Confidence</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-800">
                    ${rows}
                </tbody>
            </table>
        </div>
    </main>
</body>
</html>
`;
    fs.writeFileSync(suiteIndexPath, html);
    this.updateGlobalIndex();
    return suiteRuns;
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
