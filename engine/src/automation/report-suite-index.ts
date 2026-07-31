import fs from 'fs'
import path from 'path'
import { updateGlobalIndex } from './report-global-index.ts'

export function updateSuiteIndex(context: any, duration: string): any[] {
    const suiteIndexPath = path.join(context.suiteDir, 'suite-index.html');
    let suiteRuns: any[] = [];
    const dbPath = path.join(context.suiteDir, 'suite-data.json');
    if (fs.existsSync(dbPath)) {
      suiteRuns = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    }
    const runId = path.basename(context.reportDir);
    const durationParts = duration.split(':').map(Number);
    const durationSeconds = (durationParts[0] * 3600) + (durationParts[1] * 60) + durationParts[2];

    // Count vetoes for this run
    const vetoes = context.steps.filter((s: any) => s.guardApproved === false).length;

    const runData = {
        id: context.testLinkId,
        runId: runId,
        task: context.task,
        status: context.finalStatus,
        date: new Date().toLocaleString(),
        duration: duration,
        durationSec: durationSeconds,
        confidence: context.finalConfidence,
        tokens: context.totalTokens,
        cost: context.totalCost,
        verdict: context.finalReason,
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
    <title>Suite Dashboard - ${context.suiteName}</title>
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
            <span class="text-white font-bold tracking-tight text-lg">${context.suiteName.toUpperCase()}</span>
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
                    <div class="text-3xl font-bold text-white">${context.formatDuration(totalSeconds)}</div>
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
    context.updateGlobalIndex();
    return suiteRuns;
}
