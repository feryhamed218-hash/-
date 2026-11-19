import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  runAnnAgentTurn,
  runAnnAgentTurnStream,
  runQualityTestById,
} from './src/agent/annAgent.ts';
import { getFullAgentBlueprint } from './src/agent/blueprintExporter.ts';
import { DEFAULT_USER_LIFESTYLE_MEMORY, mergeConsentedMemory } from './src/agent/memoryConfig.ts';
import type { UserLifestyleMemory } from './src/agent/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '2mb' }));

  // Allow external separated sites / Canva integrations to call Ann API
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, agent: 'Ann | آن' });
  });

  /**
   * Returns the complete AI Agent specification
   */
  app.get('/api/agent/spec', (_req: Request, res: Response) => {
    res.json(getFullAgentBlueprint());
  });

  /**
   * Non-streaming conversational endpoint for «آن | Ann»
   */
  app.post('/api/chat', async (req: Request, res: Response) => {
    try {
      const { history, message, memory } = req.body as {
        history?: Array<{ role: 'user' | 'model'; text: string }>;
        message?: string;
        memory?: UserLifestyleMemory;
      };

      if (!message || typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ error: 'الرسالة مطلوبة.' });
        return;
      }

      const result = await runAnnAgentTurn({
        history: Array.isArray(history) ? history : [],
        userMessage: message.trim(),
        memory: memory ?? DEFAULT_USER_LIFESTYLE_MEMORY,
      });

      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unexpected server error';
      console.error('Error in /api/chat:', error);
      res.status(500).json({ error: msg });
    }
  });

  /**
   * Streaming SSE conversational endpoint for ultra-fast responses
   */
  app.post('/api/chat/stream', async (req: Request, res: Response) => {
    const { history, message, memory } = req.body as {
      history?: Array<{ role: 'user' | 'model'; text: string }>;
      message?: string;
      memory?: UserLifestyleMemory;
    };

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'الرسالة مطلوبة.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const finalResult = await runAnnAgentTurnStream(
        {
          history: Array.isArray(history) ? history : [],
          userMessage: message.trim(),
          memory: memory ?? DEFAULT_USER_LIFESTYLE_MEMORY,
        },
        {
          onTextDelta: (delta) => sendEvent('delta', { text: delta }),
          onToolTrace: (trace) => sendEvent('tool', trace),
        }
      );

      sendEvent('done', finalResult);
      res.end();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unexpected streaming error';
      console.error('Error in /api/chat/stream:', error);
      sendEvent('error', { error: msg });
      res.end();
    }
  });

  /**
   * Explicit user-consent endpoint for Memory & Lifestyle Personalization (Principle #11)
   */
  app.post('/api/memory/consent', (req: Request, res: Response) => {
    const { currentMemory, consentGranted, patch } = req.body as {
      currentMemory?: UserLifestyleMemory;
      consentGranted: boolean;
      patch?: Partial<UserLifestyleMemory>;
    };

    if (!consentGranted) {
      res.json({
        memory: { ...DEFAULT_USER_LIFESTYLE_MEMORY, consentGranted: false },
      });
      return;
    }

    const base = currentMemory ?? DEFAULT_USER_LIFESTYLE_MEMORY;
    const updated = mergeConsentedMemory(
      { ...base, consentGranted: true },
      { ...(patch ?? {}), consentGranted: true }
    );
    res.json({ memory: updated });
  });

  /**
   * Runs one of the 12 Quality Tests live against «آن | Ann» and scores it
   */
  app.post('/api/tests/run', async (req: Request, res: Response) => {
    try {
      const { testId } = req.body as { testId?: number };
      if (!testId || typeof testId !== 'number') {
        res.status(400).json({ error: 'Valid numeric testId (1-12) is required.' });
        return;
      }
      const result = await runQualityTestById(testId);
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unexpected test runner error';
      console.error('Error in /api/tests/run:', error);
      res.status(500).json({ error: msg });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ann | آن AI Agent server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
