import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../src/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiSpecPath = path.resolve(__dirname, '../../../docs/API_SPEC.md');

function extractRoutes(app) {
  const routes = [];

  function print(path, layer) {
    if (layer.route) {
      layer.route.stack.forEach((subLayer) => {
        const method = subLayer.method.toUpperCase();
        const routePath =
          `${path}${layer.route.path}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
        routes.push({ method, path: routePath });
      });
    } else if (layer.name === 'router' && layer.handle.stack) {
      let routerPath = path;
      if (layer.regexp) {
        // Express converts mounted paths to regexps, e.g. /^\/v1\/bookings\/?(?=\/|$)/
        const match = layer.regexp.source.match(/\\\/(v1\\\/[a-zA-Z0-9_\-\\/]+)/);
        if (match) {
          routerPath = '/' + match[1].replace(/\\\//g, '/');
        }
      }
      layer.handle.stack.forEach((subLayer) => {
        print(routerPath, subLayer);
      });
    }
  }

  app._router.stack.forEach((layer) => {
    print('', layer);
  });

  return routes;
}

describe('Stage 2 Group D: API Spec & Express Routes Alignment', () => {
  it('reads docs/API_SPEC.md and finds documented endpoints', () => {
    expect(fs.existsSync(apiSpecPath)).toBe(true);
    const specContent = fs.readFileSync(apiSpecPath, 'utf8');

    // Key Phase 4 & Phase 5 documented endpoints must be present
    expect(specContent).toContain('/wallet');
    expect(specContent).toContain('/wallet/add');
    expect(specContent).toContain('/wallet/withdraw');
    expect(specContent).toContain('/wallet/transactions');
    expect(specContent).toContain('/bookings');
    expect(specContent).toContain('/bookings/:id');
    expect(specContent).toContain('/bookings/:id/accept');
    expect(specContent).toContain('/bookings/:id/reject');
    expect(specContent).toContain('/bookings/:id/cancel');
    expect(specContent).toContain('/bookings/:id/extensions');
    expect(specContent).toContain('/bookings/:id/extensions/accept');
    expect(specContent).toContain('/bookings/:id/extensions/reject');
  });

  it('verifies all registered wallet and booking Express routes are documented in API_SPEC.md', () => {
    const specContent = fs.readFileSync(apiSpecPath, 'utf8');
    const routes = extractRoutes(app);

    // Filter to Phase 4 (wallet), Phase 5 (bookings), and Phase 6 (chat, notifications)
    const phaseRoutes = routes.filter(
      (r) =>
        r.path.startsWith('/v1/wallet') ||
        r.path.startsWith('/v1/bookings') ||
        r.path.startsWith('/v1/notifications'),
    );

    expect(phaseRoutes.length).toBeGreaterThanOrEqual(13);

    for (const r of phaseRoutes) {
      // Normalize /v1/bookings/:id -> /bookings/:id
      const specRoutePattern = r.path.replace(/^\/v1/, '');
      const expectedDocEntry = `${r.method} ${specRoutePattern}`;

      // Check whether specContent mentions the endpoint or path
      const pathMentioned =
        specContent.includes(specRoutePattern) || specContent.includes(expectedDocEntry);

      expect(
        pathMentioned,
        `Route ${expectedDocEntry} is registered in Express but missing from docs/API_SPEC.md`,
      ).toBe(true);
    }
  });

  it('verifies all Socket.IO events in docs/API_SPEC.md match code and vice versa (bi-directional sync)', () => {
    const specContent = fs.readFileSync(apiSpecPath, 'utf8');

    // Extract socket events from doc line: "- Socket events: `message:new`, ..."
    const socketEventLineMatch = specContent.match(/Socket events:\s*([^\n\r]+)/i);
    expect(socketEventLineMatch).not.toBeNull();

    const documentedEvents = [...socketEventLineMatch[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    expect(documentedEvents.length).toBeGreaterThanOrEqual(5);

    // Code emitted / handled socket events in socketServer.js and chatService.js
    const codeEvents = [
      'message:new',
      'pin:proposed',
      'pin:confirmed',
      'booking:updated',
      'notification:new',
      'message:read',
    ];

    // Every event in docs exists in code
    for (const docEvent of documentedEvents) {
      expect(
        codeEvents.includes(docEvent),
        `Documented socket event ${docEvent} is missing from code`,
      ).toBe(true);
    }

    // Every event in code exists in docs
    for (const codeEvent of codeEvents) {
      expect(
        documentedEvents.includes(codeEvent),
        `Code socket event ${codeEvent} is missing from docs/API_SPEC.md`,
      ).toBe(true);
    }
  });
});
