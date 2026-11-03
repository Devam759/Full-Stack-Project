import { describe, it, expect } from 'vitest';
import { createLogger } from '../src/common/logger.js';

describe('Logger Redaction (AGENTS.md Rule 7 & Security)', () => {
  it('redacts passwords, tokens, full emails, and exact coordinates from log entries', () => {
    let loggedString = '';

    // Create a destination stream capturing log lines
    const stream = {
      write(msg) {
        loggedString += msg;
      },
    };

    const logger = createLogger({
      level: 'info',
      stream,
    });

    const sensitiveData = {
      user: {
        id: 'usr_123',
        name: 'Alice',
        email: 'alice@example.com',
        password: 'SuperSecretPassword123!',
        passwordHash: '$2b$12$abcdefghijklmnopqrstuv',
      },
      auth: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy',
        accessToken: 'access_secret_token_123',
        refreshToken: 'refresh_secret_token_456',
      },
      location: {
        type: 'Point',
        coordinates: [77.5946, 12.9716],
      },
      lat: 12.9716,
      lng: 77.5946,
      publicInfo: 'Safe to log',
    };

    logger.info(sensitiveData, 'User action completed');

    const parsedLog = JSON.parse(loggedString);

    // Verify sensitive fields are redacted
    expect(parsedLog.user.password).toBe('[REDACTED]');
    expect(parsedLog.user.passwordHash).toBe('[REDACTED]');
    expect(parsedLog.user.email).toBe('[REDACTED]');
    expect(parsedLog.auth.token).toBe('[REDACTED]');
    expect(parsedLog.auth.accessToken).toBe('[REDACTED]');
    expect(parsedLog.auth.refreshToken).toBe('[REDACTED]');
    expect(parsedLog.location.coordinates).toBe('[REDACTED]');
    expect(parsedLog.lat).toBe('[REDACTED]');
    expect(parsedLog.lng).toBe('[REDACTED]');

    // Verify non-sensitive fields are preserved
    expect(parsedLog.user.id).toBe('usr_123');
    expect(parsedLog.user.name).toBe('Alice');
    expect(parsedLog.publicInfo).toBe('Safe to log');
    expect(parsedLog.msg).toBe('User action completed');
  });
});
