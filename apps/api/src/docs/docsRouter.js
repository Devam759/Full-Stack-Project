/**
 * @file apps/api/src/docs/docsRouter.js
 * Express router serving interactive Swagger UI documentation for Part C (Faculty evaluation).
 */

import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from './openapiSpec.js';

export const docsRouter = Router();

// Expose the raw OpenAPI JSON specification
docsRouter.get('/openapi.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(openapiSpec);
});

// Configure Swagger UI options
const swaggerOptions = {
  customCss: `
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info { margin: 24px 0; }
    .swagger-ui .info .title { font-size: 28px; color: #0d9488; }
    .swagger-ui .btn.authorize { background-color: #0d9488; border-color: #0d9488; color: #ffffff; }
    .swagger-ui .btn.authorize svg { fill: #ffffff; }
  `,
  customSiteTitle: 'BorrowLoop API Documentation | CS1237 MERN Project',
};

// Mount Swagger UI
docsRouter.use('/', swaggerUi.serve, swaggerUi.setup(openapiSpec, swaggerOptions));

export default docsRouter;
