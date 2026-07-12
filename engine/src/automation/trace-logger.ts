import fs from 'fs';
import path from 'path';
import { ENGINE_LOG_DIR, safePathSegment } from '../runtime-config.ts';

export interface TraceMetrics {
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCost: number;
}

export interface TraceEntry {
    timestamp: string;
    agent: string;
    model: string;
    prompt: any;
    rawResponse: any;
    metrics: TraceMetrics;
}

export class TraceLogger {
    private logFilePath: string;
    private traceFilePath: string;
    private model: string;
    private suiteId: string;
    private testId: string;
    private totalTokens: number = 0;
    private totalLatency: number = 0;
    private numCalls: number = 0;
    private startTime: number;

    constructor(suiteId: string, testId: string, model: string) {
        this.suiteId = suiteId;
        this.testId = testId;
        this.model = model;
        this.startTime = Date.now();

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0] || 'unknown-date';
        const baseDir = path.join(
            ENGINE_LOG_DIR,
            dateStr,
            safePathSegment(suiteId, 'suite'),
            safePathSegment(testId, 'test')
        );

        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }

        this.logFilePath = path.join(baseDir, 'execution.log');
        this.traceFilePath = path.join(baseDir, 'trace_details.json');

        // Initialize trace file with empty array
        fs.writeFileSync(this.traceFilePath, JSON.stringify([], null, 2));
        
        // Clean start for log file
        fs.writeFileSync(this.logFilePath, '');
        
        this.log('SYSTEM', 'INFO', `Iniciando trazabilidad para Test: ${testId} en Suite: ${suiteId}`);
    }

    getTotalTokens() { return this.totalTokens; }
    getTotalTime() { return (Date.now() - this.startTime) / 1000; }

    /**
     * Escribe una línea de log y asegura la persistencia en disco inmediata.
     */
    log(agentName: string, level: string, message: string) {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] [${this.model}] [${this.suiteId}] [${this.testId}] [${agentName}] [${level}] - ${message}\n`;
        
        // Usar appendFileSync que es bloqueante y asegura escritura
        fs.appendFileSync(this.logFilePath, logLine);
        
        // Forzar flush al sistema de archivos (Windows a veces bufferea)
        const fd = fs.openSync(this.logFilePath, 'a');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        
        const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : '\x1b[32m';
        const reset = '\x1b[0m';
        process.stdout.write(`${color}${logLine}${reset}`);
    }

    /**
     * Registra detalles profundos y actualiza métricas.
     */
    traceAI(agentName: string, prompt: any, rawResponse: any, metrics: TraceMetrics) {
        this.totalTokens += metrics.totalTokens;
        this.totalLatency += metrics.latencyMs;
        this.numCalls++;

        const traceEntry: TraceEntry = {
            timestamp: new Date().toISOString(),
            agent: agentName,
            model: this.model,
            prompt,
            rawResponse,
            metrics
        };

        try {
            const currentTrace = JSON.parse(fs.readFileSync(this.traceFilePath, 'utf8'));
            currentTrace.push(traceEntry);
            fs.writeFileSync(this.traceFilePath, JSON.stringify(currentTrace, null, 2));
            
            // Forzar persistencia del JSON también
            const fd = fs.openSync(this.traceFilePath, 'a');
            fs.fsyncSync(fd);
            fs.closeSync(fd);

            this.log(agentName, 'INFO', `AI Interaction: ${metrics.totalTokens} tokens, ${metrics.latencyMs}ms latency. Cost: $${metrics.estimatedCost.toFixed(6)}`);
        } catch (error) {
            this.log('SYSTEM', 'ERROR', `Error escribiendo trace_details.json: ${error}`);
        }
    }

    saveSummary() {
        const duration = this.getTotalTime();
        const avgLatency = this.numCalls > 0 ? (this.totalLatency / this.numCalls) : 0;
        const summary = `
================================================================================
SESSIÓN SUMMARY - ${this.testId}
================================================================================
Total Time:         ${duration.toFixed(2)}s
Total Tokens:       ${this.totalTokens}
Avg Latency:        ${avgLatency.toFixed(2)}ms
Total AI Calls:     ${this.numCalls}
Status:             Traceability Completed
================================================================================
`;
        fs.appendFileSync(this.logFilePath, summary);
        
        const fd = fs.openSync(this.logFilePath, 'a');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        
        console.log(summary);
    }
}
