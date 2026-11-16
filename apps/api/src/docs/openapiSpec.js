/**
 * @file apps/api/src/docs/openapiSpec.js
 * OpenAPI 3.0 Specification for BorrowLoop REST API.
 * Fulfills Part C (Interactive API documentation) for CS1237 Semester Project.
 */

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'BorrowLoop REST API',
    version: '1.0.0',
    description:
      'Interactive OpenAPI specification for BorrowLoop — a community peer-to-peer rental and borrowing platform with double-entry financial ledger, escrow deposits, QR handovers, dispute resolution, and real-time Socket.IO communication.\n\n' +
      '**CS1237 Full Stack Application Development - Semester Project**\n\n' +
      '### Key Conventions:\n' +
      '- **Money**: All monetary values are strictly integers in **paise** (₹1 = 100 paise). Floating point values are never accepted.\n' +
      '- **Transactions**: All mutating booking and wallet operations require a valid `Idempotency-Key` header (8–128 characters).\n' +
      '- **Errors**: RFC 9457 compliant error objects with machine-readable error codes.\n' +
      '- **Auth**: Bearer JWT tokens in the `Authorization` header (`Bearer <accessToken>`).',
    contact: {
      name: 'BorrowLoop Engineering Team',
      url: 'https://github.com/Devam759/Full-Stack-Project',
    },
  },
  servers: [
    {
      url: '/v1',
      description: 'Current Environment API Server (v1)',
    },
    {
      url: 'http://localhost:4000/v1',
      description: 'Local Development Server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Provide your JWT access token (obtained from /auth/login or /portal/auth/login)',
      },
      idempotencyKey: {
        type: 'apiKey',
        in: 'header',
        name: 'Idempotency-Key',
        description: 'Unique UUID v4 or random string (8-128 chars) ensuring safe request replays.',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                example: 'VALIDATION_ERROR',
              },
              message: {
                type: 'string',
                example: 'Invalid input parameters',
              },
              details: {
                type: 'object',
                additionalProperties: true,
              },
            },
            required: ['code', 'message'],
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '6720abc12345678901234567' },
          name: { type: 'string', example: 'Aditi Sharma' },
          email: { type: 'string', example: 'aditi@borrowloop.test' },
          role: { type: 'string', enum: ['user', 'agent', 'admin'], example: 'user' },
          status: { type: 'string', enum: ['active', 'frozen', 'banned'], example: 'active' },
          trustScore: { type: 'number', example: 95 },
          emailVerified: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Item: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '6720item123456789012345' },
          title: { type: 'string', example: 'Sony Alpha A7 IV Mirrorless Camera' },
          description: {
            type: 'string',
            example: 'Full frame camera body in mint condition with 28-70mm lens.',
          },
          category: { type: 'string', example: 'electronics' },
          rentPerDayPaise: {
            type: 'integer',
            example: 120000,
            description: '₹1,200.00 / day in paise',
          },
          depositPaise: {
            type: 'integer',
            example: 500000,
            description: '₹5,000.00 refundable deposit in paise',
          },
          minDays: { type: 'integer', example: 1 },
          maxDays: { type: 'integer', example: 7 },
          photos: {
            type: 'array',
            items: {
              type: 'string',
              example: 'https://res.cloudinary.com/borrowloop/items/photo.jpg',
            },
          },
          status: {
            type: 'string',
            enum: ['active', 'paused', 'hidden', 'pending_review'],
            example: 'active',
          },
          distanceBand: {
            type: 'string',
            example: '< 2 km',
            description: 'Coarse distance band (exact coords never exposed)',
          },
        },
      },
      Booking: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '6720book123456789012345' },
          itemId: { type: 'string', example: '6720item123456789012345' },
          borrowerId: { type: 'string', example: '6720user123456789012345' },
          lenderId: { type: 'string', example: '6720user987654321098765' },
          startDate: { type: 'string', format: 'date', example: '2026-12-01' },
          endDate: { type: 'string', format: 'date', example: '2026-12-04' },
          days: { type: 'integer', example: 4 },
          rentPaise: { type: 'integer', example: 480000, description: 'Total rent in paise' },
          depositPaise: {
            type: 'integer',
            example: 500000,
            description: 'Refundable security deposit in paise',
          },
          platformFeePaise: {
            type: 'integer',
            example: 48000,
            description: '10% platform commission in paise',
          },
          status: {
            type: 'string',
            enum: [
              'requested',
              'accepted',
              'picked_up',
              'returned',
              'completed',
              'disputed',
              'cancelled',
              'rejected',
            ],
            example: 'accepted',
          },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      WalletSummary: {
        type: 'object',
        properties: {
          availablePaise: {
            type: 'integer',
            example: 750000,
            description: 'Available balance in paise',
          },
          frozenPaise: {
            type: 'integer',
            example: 500000,
            description: 'Escrow locked security deposits',
          },
          pendingPaise: { type: 'integer', example: 0 },
          demo: { type: 'boolean', example: true, description: 'Always true; demo money mode' },
        },
      },
      AnalyticsOverview: {
        type: 'object',
        properties: {
          volumePaise: { type: 'integer', example: 12500000 },
          depositsHeldPaise: { type: 'integer', example: 4200000 },
          commissionEarnedPaise: { type: 'integer', example: 1250000 },
          disputeRatioPct: { type: 'number', example: 1.2 },
          rentedNow: { type: 'integer', example: 8 },
          users: {
            type: 'object',
            properties: {
              total: { type: 'integer', example: 45 },
              active: { type: 'integer', example: 42 },
              frozen: { type: 'integer', example: 2 },
              banned: { type: 'integer', example: 1 },
            },
          },
          bookings: {
            type: 'object',
            properties: {
              byStatus: { type: 'object' },
            },
          },
        },
      },
    },
  },
  tags: [
    { name: 'System', description: 'Platform health and readiness probes' },
    {
      name: 'Auth',
      description: 'User registration, login, token refresh, and password management',
    },
    {
      name: 'Portal Auth',
      description: 'Staff 2-Factor (TOTP) authentication for Agents and Admins',
    },
    { name: 'Users', description: 'User profile management, trust score, and blocking' },
    { name: 'Communities', description: 'Neighborhood and campus community groups' },
    {
      name: 'Items',
      description: 'Item catalog, geo-spatial query ($geoWithin), and calendar availability',
    },
    {
      name: 'Bookings',
      description: 'Booking lifecycle state machine, transitions, and QR handovers',
    },
    {
      name: 'Wallet & Ledger',
      description: 'Double-entry ledger wallet, balance deposits and withdrawals',
    },
    { name: 'Disputes', description: 'Filing disputes and customer care resolution workflows' },
    {
      name: 'Admin Analytics',
      description: 'Executive platform metrics powered by MongoDB $facet aggregation',
    },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Liveness check probe',
        responses: {
          200: {
            description: 'API is alive',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    uptimeSeconds: { type: 'integer', example: 3600 },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/ready': {
      get: {
        tags: ['System'],
        summary: 'Readiness probe verifying Database and Redis connectivity',
        responses: {
          200: {
            description: 'All backend subsystems are healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ready' },
                    checks: {
                      type: 'object',
                      properties: {
                        database: { type: 'string', example: 'healthy' },
                        redis: { type: 'string', example: 'healthy' },
                      },
                    },
                  },
                },
              },
            },
          },
          503: {
            description: 'One or more subsystems are unavailable',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user account',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string', example: 'Rohit Verma' },
                  email: { type: 'string', format: 'email', example: 'rohit@borrowloop.test' },
                  password: { type: 'string', format: 'password', example: 'SecurePassword123!' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Account successfully registered. Verification email sent.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: {
                      type: 'string',
                      example: 'Registration successful. Please verify your email.',
                    },
                    userId: { type: 'string', example: '6720abc12345678901234567' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Validation error',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          409: {
            description: 'Email already registered',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with email and password to receive JWT tokens',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'borrower@borrowloop.test' },
                  password: { type: 'string', format: 'password', example: 'Password123!' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Login successful. Returns access token and sets refresh cookie.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    accessToken: {
                      type: 'string',
                      example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                    },
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
          401: {
            description: 'Invalid credentials',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/portal/auth/login': {
      post: {
        tags: ['Portal Auth'],
        summary: 'Staff (Agent/Admin) step 1 login; returns tempToken for TOTP verification',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', example: 'admin@borrowloop.test' },
                  password: { type: 'string', example: 'Password123!' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Password verified; TOTP verification required',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tempToken: { type: 'string', example: 'temp_staff_auth_token_xyz...' },
                    message: {
                      type: 'string',
                      example: 'TOTP required to complete authentication.',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/portal/auth/totp': {
      post: {
        tags: ['Portal Auth'],
        summary: 'Staff step 2 login; verifies 6-digit TOTP code and returns portal access token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tempToken', 'totpCode'],
                properties: {
                  tempToken: { type: 'string', example: 'temp_staff_auth_token_xyz...' },
                  totpCode: { type: 'string', example: '123456' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Staff authenticated with role-based portal token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    accessToken: { type: 'string' },
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/items': {
      get: {
        tags: ['Items'],
        summary: 'Search and filter active items (with geospatial filter and cursor pagination)',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Text search query' },
          {
            name: 'category',
            in: 'query',
            schema: { type: 'string' },
            description: 'Category filter',
          },
          {
            name: 'lat',
            in: 'query',
            schema: { type: 'number' },
            description: 'User latitude for geospatial distance',
          },
          { name: 'lng', in: 'query', schema: { type: 'number' }, description: 'User longitude' },
          {
            name: 'radius',
            in: 'query',
            schema: { type: 'integer' },
            description: 'Search radius in meters',
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 20 },
            description: 'Results per page',
          },
          {
            name: 'cursor',
            in: 'query',
            schema: { type: 'string' },
            description: 'Opaque pagination cursor',
          },
        ],
        responses: {
          200: {
            description: 'Paginated list of catalog items',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Item' },
                    },
                    nextCursor: { type: 'string', nullable: true, example: 'ZXlKa1pX...==' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Items'],
        summary: 'Publish a new item for lending',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [
                  'title',
                  'description',
                  'category',
                  'rentPerDayPaise',
                  'depositPaise',
                  'communityIds',
                ],
                properties: {
                  title: { type: 'string', example: 'Camping Tent (4-Person Waterproof)' },
                  description: {
                    type: 'string',
                    example: 'Spacious 4-person tent, includes stakes and carrying bag.',
                  },
                  category: { type: 'string', example: 'outdoors' },
                  rentPerDayPaise: {
                    type: 'integer',
                    example: 35000,
                    description: '₹350.00 in paise',
                  },
                  depositPaise: {
                    type: 'integer',
                    example: 150000,
                    description: '₹1,500.00 in paise',
                  },
                  minDays: { type: 'integer', default: 1 },
                  maxDays: { type: 'integer', default: 14 },
                  communityIds: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['6720comm123456789012345'],
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Item created successfully',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
          },
          400: { description: 'Validation error' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/items/{id}': {
      get: {
        tags: ['Items'],
        summary: 'Get item details by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Item details',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
          },
          404: { description: 'Item not found' },
        },
      },
    },
    '/items/{id}/availability': {
      get: {
        tags: ['Items'],
        summary: 'Get daily calendar availability for an item (free vs booked)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'month',
            in: 'query',
            schema: { type: 'string', example: '2026-12' },
            description: 'YYYY-MM format',
          },
        ],
        responses: {
          200: {
            description: 'Availability dates',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    month: { type: 'string', example: '2026-12' },
                    bookedDates: {
                      type: 'array',
                      items: { type: 'string', format: 'date', example: '2026-12-05' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/bookings': {
      get: {
        tags: ['Bookings'],
        summary: 'List user bookings (as borrower or lender)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'role', in: 'query', schema: { type: 'string', enum: ['borrower', 'lender'] } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'List of bookings',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    bookings: { type: 'array', items: { $ref: '#/components/schemas/Booking' } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Bookings'],
        summary: 'Request a new item booking (atomic escrow lock via Mongo transaction)',
        security: [{ bearerAuth: [] }, { idempotencyKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['itemId', 'startDate', 'endDate'],
                properties: {
                  itemId: { type: 'string', example: '6720item123456789012345' },
                  startDate: { type: 'string', format: 'date', example: '2026-12-01' },
                  endDate: { type: 'string', format: 'date', example: '2026-12-03' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Booking requested and funds locked in escrow',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Booking' } } },
          },
          400: { description: 'Invalid dates or range' },
          409: { description: 'Dates already reserved or insufficient wallet funds' },
        },
      },
    },
    '/bookings/{id}/accept': {
      post: {
        tags: ['Bookings'],
        summary: 'Lender accepts a requested booking',
        security: [{ bearerAuth: [] }, { idempotencyKey: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Booking accepted',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Booking' } } },
          },
        },
      },
    },
    '/wallet': {
      get: {
        tags: ['Wallet & Ledger'],
        summary: 'Get authenticated user wallet balance and escrow status',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Wallet balances in integer paise',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/WalletSummary' } },
            },
          },
        },
      },
    },
    '/wallet/add': {
      post: {
        tags: ['Wallet & Ledger'],
        summary: 'Top up demo wallet balance (double-entry ledger credit)',
        security: [{ bearerAuth: [] }, { idempotencyKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['amountPaise'],
                properties: {
                  amountPaise: {
                    type: 'integer',
                    example: 500000,
                    description: '₹5,000.00 top-up in paise',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Funds credited to available balance',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/WalletSummary' } },
            },
          },
        },
      },
    },
    '/admin/analytics/overview': {
      get: {
        tags: ['Admin Analytics'],
        summary: 'Executive dashboard analytics (MongoDB $facet aggregation + 60s Redis cache)',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'High performance aggregated analytics',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AnalyticsOverview' } },
            },
          },
          403: { description: 'Forbidden: Admin role required' },
        },
      },
    },
  },
};

export default openapiSpec;
