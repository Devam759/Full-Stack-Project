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
  COMMISSION_BPS: 1500, // 15% (1500 basis points)
  COMMISSION_APPLIES_TO: Object.freeze(['rent', 'late_charge']),
  COMMISSION_DOES_NOT_APPLY_TO: Object.freeze(['deposit_compensation']),

  // Booking Limits
  MIN_BOOKING_DAYS: 1,
  MAX_BOOKING_DAYS: 30,
  REQUEST_EXPIRY_HOURS: 24,
  REQUEST_EXPIRY_SECONDS: 24 * 60 * 60,
  LATE_CANCEL_THRESHOLD_HOURS: 6,
  LATE_CANCEL_THRESHOLD_SECONDS: 6 * 60 * 60,
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
  DATA_SENSITIVE_CATEGORIES: Object.freeze(['phones', 'laptops', 'tablets', 'storage_devices']),

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

  // Background Job Intervals (in minutes/cron)
  BACKGROUND_JOBS: Object.freeze({
    EXPIRE_REQUESTS_MINUTES: 5,
    EXPIRE_PICKUPS_MINUTES: 15,
    DUE_REMINDERS_MINUTES: 15,
    ACCRUE_LATE_CHARGES_MINUTES: 60,
    AUTO_COMPLETE_RETURNS_MINUTES: 15,
    REVEAL_RATINGS_HOURS: 24,
    LEDGER_RECONCILIATION_CRON: '0 2 * * *',
  }),
});

export default BUSINESS_CONFIG;
