import type express from 'express';
import { actMcpBrowserSession, closeMcpBrowserSession, inspectMcpBrowserSession, openMcpBrowserSession } from './mcp-browser-sessions.ts';

export function registerMcpBrowserRoutes(app: express.Express, protectedEndpoint: (req: express.Request, res: express.Response) => boolean) {
  app.post('/internal/mcp/browser/:operation', async (req, res) => {
    if (!protectedEndpoint(req, res)) return;
    const body = req.body || {};
    const owner = String(body.owner_id || '');
    const projectId = String(body.project_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(owner) || !/^[0-9a-f-]{36}$/i.test(projectId)) return res.status(400).json({ error: 'Invalid browser scope' });
    try {
      let result;
      switch (req.params.operation) {
        case 'open': result = await openMcpBrowserSession(owner, projectId, String(body.url || '')); break;
        case 'inspect': result = await inspectMcpBrowserSession(owner, projectId, String(body.browser_id || '')); break;
        case 'act': result = await actMcpBrowserSession(owner, projectId, body); break;
        case 'close': result = await closeMcpBrowserSession(owner, projectId, String(body.browser_id || '')); break;
        default: return res.sendStatus(404);
      }
      return res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Browser operation failed';
      const status = /no pública|red no pública|credenciales embebidas|URL inválida/i.test(message) ? 400
        : /no encontrada|expiró/i.test(message) ? 404 : /net::|Timeout|timeout|Navigation/i.test(message) ? 502 : 422;
      return res.status(status).json({ error: message.slice(0, 240) });
    }
  });
}
