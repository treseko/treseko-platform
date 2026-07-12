import { runTask } from './index';
import fs from 'fs';
import path from 'path';

interface TestCase {
  id: string;
  task: string;
  url: string;
  expected?: string;
  guidance?: string;
}

const smokeSuite: TestCase[] = [
  { 
    id: 'SMOKE-01', 
    task: 'Rellena Full Name en https://demoqa.com/text-box', 
    url: 'https://demoqa.com/text-box', 
    expected: 'El campo de nombre debe mostrar el texto ingresado.',
    guidance: '1. Escribe "Juan Perez" en el campo Full Name. 2. Haz clic en Submit.'
  },
  { id: 'SMOKE-02', task: 'Rellena Email en https://demoqa.com/text-box', url: 'https://demoqa.com/text-box' },
  // ... (rest of cases)
];

async function runSuite() {
  const suiteName = 'smoke-tests';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const results: { id: string, task: string, status: string, tokens: number, time: number }[] = [];

  console.log(`🚀 Starting Automation Suite: ${suiteName.toUpperCase()} (${smokeSuite.length} tests)\n`);
  
  let suiteTotalTokens = 0;
  let suiteTotalTime = 0;

  for (const test of smokeSuite) {
    try {
      console.log(`\n[${results.length + 1}/${smokeSuite.length}] Ejecutando ${test.id}: ${test.task.substring(0, 50)}...`);
      const summary = await runTask(test.task, test.url, 15, test.id, suiteName, test.expected, test.guidance);
      results.push({ ...test, status: 'COMPLETED', tokens: summary.tokens, time: summary.time });
      suiteTotalTokens += summary.tokens;
      suiteTotalTime += summary.time;
    } catch (e) {
      results.push({ ...test, status: 'FAILED', tokens: 0, time: 0 });
    }
  }

  // Generate Summary Report
  const summaryHtml = `
  <html>
    <head>
      <title>Suite Summary - ${suiteName}</title>
      <style>
        body { font-family: sans-serif; margin: 40px; background: #f0f2f5; }
        .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #1a73e8; }
        .stats { display: flex; gap: 20px; margin: 20px 0; padding: 15px; background: #e8f0fe; border-radius: 4px; }
        .stat-item { flex: 1; }
        .stat-label { font-size: 0.8rem; color: #5f6368; text-transform: uppercase; }
        .stat-value { font-size: 1.5rem; color: #1a73e8; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
        .status-COMPLETED { color: #28a745; font-weight: bold; }
        .status-FAILED { color: #dc3545; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Suite Summary: ${suiteName.toUpperCase()}</h1>
        <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
        
        <div class="stats">
            <div class="stat-item"><div class="stat-label">Total Tests</div><div class="stat-value">${results.length}</div></div>
            <div class="stat-item"><div class="stat-label">Total Tokens</div><div class="stat-value">${suiteTotalTokens}</div></div>
            <div class="stat-item"><div class="stat-label">Total Time</div><div class="stat-value">${suiteTotalTime.toFixed(2)}s</div></div>
        </div>

        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Task</th>
              <th>Status</th>
              <th>Tokens</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            ${results.map(r => `
              <tr>
                <td>${r.id}</td>
                <td>${r.task}</td>
                <td><span class="status-${r.status}">${r.status}</span></td>
                <td>${r.tokens}</td>
                <td>${r.time.toFixed(2)}s</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </body>
  </html>
  `;

  const summaryPath = path.join('reports', suiteName, `summary_${timestamp}.html`);
  fs.writeFileSync(summaryPath, summaryHtml);

  console.log('\n================================================================================');
  console.log(`SUITE GLOBAL SUMMARY: ${suiteName.toUpperCase()}`);
  console.log(`Total Time:   ${suiteTotalTime.toFixed(2)}s`);
  console.log(`Total Tokens: ${suiteTotalTokens}`);
  console.log('================================================================================');
  console.log(`\n✅ Suite execution finished.`);
  console.log(`📊 Global Summary Report: ${path.resolve(summaryPath)}`);
}


runSuite();
