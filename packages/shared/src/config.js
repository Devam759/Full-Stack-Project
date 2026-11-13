/**
 * @file packages/shared/src/config.js
 * Single source of truth for all business numbers, limits, durations, and constants.
 * As per hard rule 4 in AGENTS.md, all business numbers come only from this file.
 */

export const BUSINESS_CONFIG = Object.freeze({
  // Currency and Money
  CURRENCY: 'INR',
  PAISE_PER_RUPEE: 100,
  WALLET_CAP_PAISE: 50_000_00, // Rs 50,000 in integer paise
  MIN_WALLET_ADD_PAISE: 100_00, // Min Rs 100 add
  MAX_WALLET_ADD_PAISE: 50_000_00, // Max Rs 50,000 add (subject to cap)
  MIN_WALLET_WITHDRAW_PAISE: 100_00, // Min Rs 100 withdraw
  MAX_WALLET_WITHDRAW_PAISE: 50_000_00, // Max Rs 50,000 withdraw
  COMMISSION_BPS: 1500, // 15% (1500 basis points)
  COMMISSION_APPLIES_TO: Object.freeze(['rent', 'late_charge']),
  COMMISSION_DOES_NOT_APPLY_TO: Object.freeze(['deposit_compensation']),

  // Ledger & Wallet Architecture (Phase 4)
  TRANSACTION_RETRY_CAP: 30,
  IDEMPOTENCY_TTL_SECONDS: 24 * 60 * 60, // 24 hours
  RECONCILIATION_BATCH_SIZE: 100,
  MAX_RECONCILIATION_STORED_MISMATCHES: 100,
  RECONCILIATION_RESUME_TIMEOUT_MS: 15 * 60 * 1000, // 15 mins
  LEDGER_ACCOUNTS: Object.freeze([
    'available',
    'frozen',
    'pending',
    'platform_revenue',
    'demo_funding',
  ]),
  LEDGER_ENTRY_TYPES: Object.freeze([
    'deposit_funds',
    'withdraw_funds',
    'booking_hold',
    'extension_hold',
    'deposit_release',
    'booking_cancel_refund',
    'settlement',
    'commission',
  ]),
  WALLET_RATE_LIMITS: Object.freeze({
    ADD_FUNDS: Object.freeze({ windowSeconds: 60, maxRequests: 10 }),
    WITHDRAW_FUNDS: Object.freeze({ windowSeconds: 60, maxRequests: 10 }),
    TRANSACTIONS_LIST: Object.freeze({ windowSeconds: 60, maxRequests: 60 }),
  }),

  // Booking Limits
  TIMEZONE: 'Asia/Kolkata',
  MIN_BOOKING_DAYS: 1,
  MAX_BOOKING_DAYS: 30,
  REQUEST_EXPIRY_HOURS: 24,
  REQUEST_EXPIRY_SECONDS: 24 * 60 * 60,
  LATE_CANCEL_THRESHOLD_HOURS: 6,
  LATE_CANCEL_THRESHOLD_SECONDS: 6 * 60 * 60,
  LATE_CANCEL_COMPENSATION_LENDER: false,
  MAX_BOOKING_EXTENSIONS: 3,
  EXTENSION_EXPIRY_HOURS: 24,
  EXTENSION_EXPIRY_SECONDS: 24 * 60 * 60,
  OVERDUE_DISPUTE_DAYS: 3,
  OVERDUE_DISPUTE_SECONDS: 3 * 24 * 60 * 60,
  RETURN_CONFIRMATION_WINDOW_HOURS: 24,
  RETURN_CONFIRMATION_WINDOW_SECONDS: 24 * 60 * 60,

  // Handover QR & Security
  QR_EXPIRY_SECONDS: 30,
  QR_FALLBACK_CODE_LENGTH: 6,
  QR_FALLBACK_MAX_ATTEMPTS: 3,

  // Auth, Tokens & Sessions
  ACCESS_TOKEN_EXPIRY_MINUTES: 15,
  ACCESS_TOKEN_EXPIRY_SECONDS: 15 * 60, // 900 seconds
  REFRESH_TOKEN_EXPIRY_DAYS: 30,
  REFRESH_TOKEN_EXPIRY_SECONDS: 30 * 24 * 60 * 60,
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
  BCRYPT_SALT_ROUNDS: 12,
  MIN_USER_AGE_YEARS: 18,
  TOKEN_AUDIENCES: Object.freeze({
    USER: 'borrowloop:user',
    PORTAL: 'borrowloop:portal',
    PORTAL_PRE_TOTP: 'borrowloop:portal_pre_totp',
  }),
  ALLOW_REFRESH_TOKEN_BODY_FALLBACK: process.env.NODE_ENV !== 'production',
  TOTP_SETTINGS: Object.freeze({
    ISSUER: 'BorrowLoop',
    STEP_SECONDS: 30,
    WINDOW: 1, // +/- 1 step tolerance
    MAX_ATTEMPTS: 5,
  }),

  // Ratings
  MIN_RATING_STARS: 1,
  MAX_RATING_STARS: 5,
  RATING_REVEAL_DAYS: 7,
  RATING_REVEAL_SECONDS: 7 * 24 * 60 * 60,

  // Trust Score (0 to 100, starts at 50)
  INITIAL_TRUST_SCORE: 50,
  MIN_TRUST_SCORE: 0,
  MAX_TRUST_SCORE: 100,
  TRUST_SCORE_RATING_MAX_SWING: 20,
  TRUST_SCORE_RATING_FULL_EFFECT_COUNT: 10,
  TRUST_SCORE_ON_TIME_DELTA: 2,
  TRUST_SCORE_ON_TIME_MAX_TOTAL: 20,
  TRUST_SCORE_LOST_DISPUTE_DELTA: -10,
  TRUST_SCORE_NO_SHOW_DELTA: -5,
  TRUST_SCORE_LATE_CANCEL_DELTA: -3,
  TRUST_SCORE_REJECTED_DAMAGE_CLAIM_DELTA: -5,

  // Strikes
  STRIKE_1_ACTION: 'warning',
  STRIKE_2_BAN_DAYS: 7,
  STRIKE_2_BAN_SECONDS: 7 * 24 * 60 * 60,
  STRIKE_3_ACTION: 'permanent_ban',

  // Communities Limits & Rules
  MAX_COMMUNITIES_JOINED: 20,
  MAX_COMMUNITIES_CREATED: 5,
  MAX_NEARBY_COMMUNITIES: 50,
  COMMUNITY_INVITE_CODE_LENGTH: 10,
  COMMUNITY_REQUEST_COOLDOWN_HOURS: 24,
  COMMUNITY_REQUEST_COOLDOWN_SECONDS: 24 * 60 * 60,
  RESERVED_COMMUNITY_NAMES: Object.freeze([
    'admin',
    'root',
    'support',
    'help',
    'api',
    'borrowloop',
    'system',
    'official',
    'portal',
    'care',
  ]),

  // Moderation & Reports
  ITEM_REPORTS_HIDE_THRESHOLD: 3,
  PROHIBITED_CATEGORIES: Object.freeze([
    'weapons and ammunition',
    'drugs',
    'alcohol and tobacco',
    'medicines',
    'adult items',
    'vehicles',
    'hazardous or explosive materials',
    'live animals',
    'stolen goods',
  ]),
  DATA_SENSITIVE_CATEGORIES: Object.freeze([
    'electronics_and_gadgets',
    'phones',
    'laptops',
    'tablets',
    'storage_devices',
  ]),

  // Allowed Categories & Conditions (Phase 3)
  ITEM_CATEGORIES: Object.freeze([
    'books_and_study',
    'electronics_and_gadgets',
    'home_and_kitchen',
    'tools_and_diy',
    'sports_and_fitness',
    'outdoor_and_camping',
    'board_games_and_hobbies',
    'party_and_events',
    'clothing_and_costumes',
    'musical_instruments',
    'other',
  ]),
  ITEM_CONDITIONS: Object.freeze(['new', 'like_new', 'good', 'fair']),
  ITEM_STATUSES: Object.freeze(['active', 'paused', 'pending_review', 'hidden', 'removed']),
  BOOKING_STATUSES: Object.freeze([
    'requested',
    'accepted',
    'picked_up',
    'returned',
    'disputed',
    'completed',
    'cancelled',
    'expired',
  ]),
  ACTIVE_BOOKING_STATUSES: Object.freeze(['accepted', 'picked_up', 'returned', 'disputed']),

  // Prohibited Words Blocklist (Title & Description triggers pending_review)
  PROHIBITED_WORDS_BLOCKLIST: Object.freeze([
    'gun',
    'guns',
    'firearm',
    'firearms',
    'pistol',
    'rifle',
    'ammunition',
    'ammo',
    'weapon',
    'weapons',
    'knife',
    'knives',
    'explosive',
    'bomb',
    'drug',
    'drugs',
    'weed',
    'cannabis',
    'marijuana',
    'cocaine',
    'heroin',
    'alcohol',
    'liquor',
    'whiskey',
    'vodka',
    'beer',
    'wine',
    'tobacco',
    'cigarette',
    'cigarettes',
    'vape',
    'nicotine',
    'medicine',
    'medicines',
    'prescription',
    'pharma',
    'steroids',
    'adult',
    'porn',
    'sex',
    'erotic',
    'stolen',
    'poison',
    'hazardous',
  ]),

  // Item Limits & Sanity Bounds
  MAX_ACTIVE_ITEMS_PER_USER: 50,
  DAILY_UPLOAD_LIMIT_PER_USER: 30,
  MIN_RENT_PER_DAY_PAISE: 0,
  MAX_RENT_PER_DAY_PAISE: 10_000_00, // Rs 10,000 / day
  MIN_DEPOSIT_PAISE: 0,
  MAX_DEPOSIT_PAISE: 50_000_00, // Rs 50,000 max deposit
  MIN_LATE_FEE_PER_DAY_PAISE: 0,
  MAX_LATE_FEE_PER_DAY_PAISE: 10_000_00, // Rs 10,000 / day
  MAX_SEARCH_RADIUS_KM: 100,
  DEFAULT_SEARCH_RADIUS_KM: 10,
  AVAILABILITY_MAX_MONTHS_AHEAD: 6,

  // Upload Limits & Storage
  MAX_ITEM_PHOTOS: 6,
  MAX_PROFILE_PHOTOS: 1,
  MAX_HANDOVER_PHOTOS: 6,
  MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
  ALLOWED_IMAGE_MIME_TYPES: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
  ALLOWED_IMAGE_EXTENSIONS: Object.freeze(['jpg', 'jpeg', 'png', 'webp']),
  UPLOAD_FOLDERS: Object.freeze({
    PROFILE: 'borrowloop/profiles',
    ITEM: 'borrowloop/items',
    HANDOVER: 'borrowloop/handovers',
  }),

  // Pagination & Lists
  DEFAULT_PAGE_LIMIT: 20,
  MAX_PAGE_LIMIT: 50,

  // Architecture & Scale Targets
  SCALE_TARGETS: Object.freeze({
    REGISTERED_USERS: 100_000,
    DAILY_ACTIVE_USERS: 5_000,
    PEAK_CONCURRENT_USERS: 500,
    PEAK_RPS: 150,
    PEAK_CONCURRENT_SOCKETS: 2_000,
  }),

  // Background Job Intervals (in minutes/cron per docs/ARCHITECTURE.md Section 8)
  BACKGROUND_JOBS: Object.freeze({
    EXPIRE_REQUESTS_MINUTES: 5,
    EXPIRE_PICKUPS_MINUTES: 15,
    EXPIRE_EXTENSIONS_MINUTES: 15,
    EXPIRY_BATCH_SIZE: 100,
    DUE_REMINDERS_MINUTES: 15,
    ACCRUE_LATE_CHARGES_MINUTES: 60,
    AUTO_COMPLETE_RETURNS_MINUTES: 15,
    REVEAL_RATINGS_HOURS: 24,
    LEDGER_RECONCILIATION_CRON: '0 2 * * *',
    PICKUP_REMINDERS_MINUTES: 15,
    OUTBOX_DISPATCHER_SECONDS: 10,
    DUE_REMINDERS_THRESHOLD_HOURS: 2,
    PICKUP_REMINDERS_THRESHOLD_HOURS: 2,
  }),

  // Chat Configuration (Phase 6)
  CHAT: Object.freeze({
    MAX_MESSAGE_LENGTH: 1000,
    MESSAGE_TYPES: Object.freeze(['text', 'pin', 'system']),
    PIN_STATUSES: Object.freeze(['proposed', 'confirmed']),
    TERMINAL_STATUSES: Object.freeze(['completed', 'cancelled', 'expired']),
    MAX_PIN_RADIUS_KM: 50,
    SOCKET_MAX_PAYLOAD_BYTES: 10 * 1024,
    SOCKET_MAX_CONNECTIONS_PER_USER: 5,
    RATE_LIMITS: Object.freeze({
      SEND_MESSAGE_USER: Object.freeze({ windowSeconds: 60, maxRequests: 30 }),
      SEND_MESSAGE_CONV: Object.freeze({ windowSeconds: 60, maxRequests: 60 }),
      PROPOSE_PIN: Object.freeze({ windowSeconds: 60, maxRequests: 10 }),
      CONFIRM_PIN: Object.freeze({ windowSeconds: 60, maxRequests: 10 }),
    }),
    DEFAULT_PAGE_LIMIT: 30,
    MAX_PAGE_LIMIT: 100,
  }),

  // Notifications Configuration (Phase 6)
  NOTIFICATIONS: Object.freeze({
    TTL_SECONDS: 90 * 24 * 60 * 60, // 90 days per docs/DATABASE_SCHEMA.md
    DEFAULT_PAGE_LIMIT: 20,
    MAX_PAGE_LIMIT: 50,
    TYPES: Object.freeze([
      'booking_requested',
      'booking_accepted',
      'booking_rejected',
      'booking_cancelled',
      'extension_requested',
      'extension_accepted',
      'extension_rejected',
      'pickup_reminder',
      'due_reminder',
      'pickup_expired',
      'message_received',
      'pin_proposed',
      'pin_confirmed',
      'reconciliation_mismatch',
    ]),
  }),

  // Outbox Dispatcher Configuration (Phase 6)
  OUTBOX: Object.freeze({
    POLL_INTERVAL_MS: 5000,
    BATCH_SIZE: 50,
    MAX_RETRIES: 5,
    INITIAL_BACKOFF_MS: 1000,
    MAX_BACKOFF_MS: 60000,
    LEASE_TIMEOUT_MS: 5 * 60 * 1000, // 5 min lease for crash recovery
  }),
});

export default BUSINESS_CONFIG;
