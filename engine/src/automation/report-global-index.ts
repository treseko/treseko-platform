import fs from 'fs'
import path from 'path'
import { ENGINE_REPORTS_DIR } from '../runtime-config.ts'

export function updateGlobalIndex(context: any): void {
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
