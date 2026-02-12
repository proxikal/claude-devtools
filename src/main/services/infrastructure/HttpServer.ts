/**
 * HttpServer - Fastify-based HTTP server for serving the renderer UI and API routes.
 *
 * Binds to 127.0.0.1 only for localhost security.
 * Dynamically allocates a port starting from 3456.
 * In production, serves static files from the renderer output directory.
 * In development, Vite dev server handles static files.
 */

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { type HttpServices, registerHttpRoutes } from '@main/http';
import { broadcastEvent } from '@main/http/events';
import { createLogger } from '@shared/utils/logger';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'fs';
import { join } from 'path';

const logger = createLogger('Service:HttpServer');

export class HttpServer {
  private app: FastifyInstance | null = null;
  private port: number = 3456;
  private running: boolean = false;

  /**
   * Start the HTTP server.
   * @param services - Service instances to pass to route handlers
   * @param sshModeSwitchCallback - Callback for SSH mode switching
   * @param preferredPort - Port to try first (default 3456)
   */
  async start(
    services: HttpServices,
    sshModeSwitchCallback: (mode: 'local' | 'ssh') => Promise<void>,
    preferredPort: number = 3456
  ): Promise<number> {
    this.app = Fastify({ logger: false });

    // Register CORS - allow all localhost origins
    const localhostPattern = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;
    await this.app.register(cors, {
      origin: (origin, cb) => {
        // Allow requests with no origin (same-origin, curl, etc.)
        if (!origin) {
          cb(null, true);
          return;
        }
        // Allow any localhost origin
        if (localhostPattern.test(origin)) {
          cb(null, true);
          return;
        }
        cb(new Error('Not allowed by CORS'), false);
      },
      credentials: true,
    });

    // Register static file serving (production only)
    const isDev = process.env.NODE_ENV === 'development';
    if (!isDev) {
      const rendererPathCandidates = [
        join(__dirname, '../../../out/renderer'),
        join(__dirname, '../../renderer'),
      ];
      const rendererPath =
        rendererPathCandidates.find((candidate) => existsSync(candidate)) ??
        rendererPathCandidates[0];
      await this.app.register(fastifyStatic, {
        root: rendererPath,
        prefix: '/',
        // Don't serve index.html for API routes
        wildcard: false,
      });

      // Serve index.html for all non-API routes (SPA fallback)
      this.app.setNotFoundHandler(async (request, reply) => {
        if (request.url.startsWith('/api/')) {
          return reply.status(404).send({ error: 'Not found' });
        }
        return reply.sendFile('index.html');
      });
    }

    // Register all API routes
    registerHttpRoutes(this.app, services, sshModeSwitchCallback);

    // Try ports starting from preferredPort
    for (let attempt = 0; attempt <= 10; attempt++) {
      const tryPort = preferredPort + attempt;
      try {
        await this.app.listen({ host: '127.0.0.1', port: tryPort });
        this.port = tryPort;
        this.running = true;
        logger.info(`HTTP server started on http://127.0.0.1:${tryPort}`);
        return tryPort;
      } catch (err: unknown) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'EADDRINUSE') {
          logger.info(`Port ${tryPort} in use, trying next...`);
          continue;
        }
        throw err;
      }
    }

    throw new Error(`Could not find available port (tried ${preferredPort}-${preferredPort + 10})`);
  }

  /**
   * Stop the HTTP server gracefully.
   */
  async stop(): Promise<void> {
    if (this.app && this.running) {
      await this.app.close();
      this.running = false;
      this.app = null;
      logger.info('HTTP server stopped');
    }
  }

  /**
   * Broadcast an event to all connected SSE clients.
   */
  broadcast(channel: string, data: unknown): void {
    broadcastEvent(channel, data);
  }

  /**
   * Get the current port the server is running on.
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Check if the server is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }
}
