import WebSocket from 'ws';

type ProgressChannelOptions = {
  testId: string;
  stepMap: Record<string, string>;
  io?: any;
  wsUrl: string;
  correlationId?: string;
};

export function createProgressChannel(options: ProgressChannelOptions) {
  const ws = new WebSocket(options.wsUrl);
  let ready = false;
  const pending: string[] = [];
  const eventType = (event: string): string => event === 'step_result'
    ? 'STEP_RESULT'
    : event === 'agent_event'
      ? 'AGENT_LOG'
      : event === 'execution_finished' ? 'EXECUTION_FINISHED' : 'STREAM_DOM_LOG';

  ws.on('open', () => {
    ready = true;
    while (pending.length && ws.readyState === WebSocket.OPEN) ws.send(pending.shift() as string);
  });
  ws.on('error', (error) => {
    ready = false;
    console.warn(`[WS] Backend progress stream unavailable for ${options.testId}: ${(error as Error)?.message || error}`);
  });
  ws.on('close', () => { ready = false; });

  const emit = (event: string, data: any) => {
    const correlatedData = { ...data, correlation_id: data?.correlation_id || options.correlationId };
    try { options.io?.to(options.testId).emit(event, correlatedData); } catch (_) {}
    const snapshotId = correlatedData.step ? options.stepMap[correlatedData.step.toString()] : null;
    const message = JSON.stringify({
      type: eventType(event),
      ...correlatedData,
      snapshot_id: snapshotId,
      text: correlatedData.message || JSON.stringify(correlatedData),
    });
    if (ready && ws.readyState === WebSocket.OPEN) {
      try { ws.send(message); } catch (error) {
        ready = false;
        pending.push(message);
        console.warn(`[WS] Could not send progress for ${options.testId}: ${(error as Error)?.message || error}`);
      }
    } else pending.push(message);
  };

  const flushAndClose = async () => {
    if (ws.readyState !== WebSocket.OPEN) { try { ws.close(); } catch (_) {} return; }
    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => { if (resolved) return; resolved = true; resolve(); };
      ws.once('close', finish);
      setTimeout(finish, 350);
      try { ws.close(1000, 'execution finished'); } catch (_) { finish(); }
    });
  };
  return { emit, flushAndClose };
}
