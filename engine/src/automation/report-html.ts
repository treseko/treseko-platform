export function generateHtml(context: any, duration: string, suiteData: any[]): string {
    const statusColor = context.finalStatus === 'PASSED' ? '#10b981' : (context.finalStatus === 'FAILED' ? '#ef4444' : '#f59e0b');
    const confidenceColor = context.finalConfidence > 80 ? '#10b981' : (context.finalConfidence > 50 ? '#f59e0b' : '#ef4444');

    const timelineItems = context.steps.map((s: any, idx: number) => `
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

    const manualCards = context.steps.map((s: any) => `
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
              <div class="text-[10px] text-slate-600 font-mono">${context.modelUsed}</div>
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
    <title>AI Trace - ${context.testLinkId}</title>
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
                <a href="../suite-index.html" class="hover:text-white transition-colors">${context.suiteName}</a>
                <span>/</span>
                <span class="text-slate-100 font-medium">${context.testLinkId}</span>
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
                            <h1 class="text-2xl font-bold text-white tracking-tight">${context.task}</h1>
                            <p class="text-slate-500 mt-1 text-sm">Ejecución agéntica iniciada en ${new Date(context.startTime).toLocaleTimeString()}</p>
                        </div>
                        <div class="flex flex-col items-end">
                            <span class="px-3 py-1 rounded-full text-xs font-bold bg-slate-800 border border-slate-700" style="color: ${statusColor}">
                                ${context.finalStatus}
                            </span>
                            <span class="text-[10px] text-slate-500 mt-2 font-mono">Duration: ${duration}</span>
                        </div>
                    </div>

                    ${context.manualSteps ? `
                    <div class="mb-8 p-4 bg-sky-500/5 border border-sky-500/20 rounded-xl">
                        <h3 class="text-[10px] font-bold text-sky-400 uppercase tracking-widest mb-2">Guía Manual de Pasos</h3>
                        <p class="text-sm text-slate-300 leading-relaxed whitespace-pre-line">${context.sanitize(context.manualSteps)}</p>
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
                            <div class="text-xs font-mono text-sky-400">${context.modelUsed}</div>
                        </div>
                        <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                            <div class="text-[10px] text-slate-500 mb-1">Audit Confidence</div>
                            <div class="text-xl font-bold" style="color: ${confidenceColor}">${context.finalConfidence}%</div>
                        </div>
                        <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                            <div class="text-[10px] text-slate-500 mb-1">Total Consumption</div>
                            <div class="text-xs text-slate-300 font-mono">${context.totalTokens.toLocaleString()} tokens</div>
                            <div class="text-xs text-slate-500 mt-1">Est. Cost: $${context.totalCost.toFixed(4)}</div>
                        </div>
                    </div>
                </section>

                <section>
                    <h3 class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">Auditor Verdict</h3>
                    <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700 border-l-4" style="border-left-color: ${statusColor}">
                        <p class="text-xs leading-relaxed text-slate-300">${context.finalReason}</p>
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
                            ESTADO: ${context.finalStatus}
                        </div>
                    </div>

                    <div class="grid grid-cols-3 gap-8 mb-12">
                        <div class="col-span-2">
                            <div class="text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">Script de Prueba (Guía Manual)</div>
                            <div class="bg-sky-500/5 rounded-2xl p-6 border border-sky-500/20 text-sm text-slate-300 leading-relaxed whitespace-pre-line shadow-inner">
                                ${context.manualSteps || context.task}
                            </div>
                        </div>
                        <div class="space-y-4">
                            <div>
                                <div class="text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">Pre-condiciones</div>
                                <div class="bg-slate-800/30 rounded-xl p-4 border border-slate-800 text-xs text-slate-400">
                                    ${context.preConditions}
                                </div>
                            </div>
                            <div>
                                <div class="text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">Post-condiciones</div>
                                <div class="bg-slate-800/30 rounded-xl p-4 border border-slate-800 text-xs text-slate-400">
                                    ${context.postConditions}
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
                        <p class="text-slate-300 text-lg leading-relaxed max-w-3xl">${context.finalReason}</p>
                        <div class="mt-8 flex items-center gap-6">
                            <div class="flex flex-col">
                                <span class="text-[10px] text-slate-500 font-bold uppercase mb-1">Resultado Final</span>
                                <span class="text-2xl font-black text-emerald-500 tracking-tighter">${context.finalStatus}</span>
                            </div>
                            <div class="w-px h-10 bg-slate-700"></div>
                            <div class="flex flex-col">
                                <span class="text-[10px] text-slate-500 font-bold uppercase mb-1">Confianza de IA</span>
                                <span class="text-2xl font-black text-white tracking-tighter">${context.finalConfidence}%</span>
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
