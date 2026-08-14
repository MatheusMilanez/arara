import { describe, expect, it } from 'vitest';
import { buildHealthResponse } from '../../src/api/routes/health.js';

describe('buildHealthResponse', () => {
  it('returns 200/ok when both dependencies are healthy', () => {
    const { statusCode, body } = buildHealthResponse({ status: 'ok', latencyMs: 2 }, { status: 'ok', latencyMs: 1 });

    expect(statusCode).toBe(200);
    expect(body['status']).toBe('ok');
  });

  it('returns 503/error when the database is down', () => {
    const { statusCode, body } = buildHealthResponse(
      { status: 'error', latencyMs: 5, error: 'timeout' },
      { status: 'ok', latencyMs: 1 },
    );

    expect(statusCode).toBe(503);
    expect(body['status']).toBe('error');
    const services = body['services'] as Record<string, { status: string }>;
    expect(services['database']?.status).toBe('error');
    expect(services['redis']?.status).toBe('ok');
  });

  it('returns 503/error when redis is down', () => {
    const { statusCode, body } = buildHealthResponse(
      { status: 'ok', latencyMs: 2 },
      { status: 'error', latencyMs: 5, error: 'ECONNREFUSED' },
    );

    expect(statusCode).toBe(503);
    const services = body['services'] as Record<string, { status: string }>;
    expect(services['redis']?.status).toBe('error');
  });

  it('returns 503/error when both dependencies are down', () => {
    const { statusCode } = buildHealthResponse(
      { status: 'error', latencyMs: 5, error: 'timeout' },
      { status: 'error', latencyMs: 5, error: 'ECONNREFUSED' },
    );

    expect(statusCode).toBe(503);
  });
});
