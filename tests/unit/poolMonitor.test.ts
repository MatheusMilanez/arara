import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPoolNearCapacity, pool, startPoolMonitor } from '../../src/database/client.js';

describe('pool config (ARARA-211)', () => {
  it('mantém max=20, min=10 e timeout de conexão de 5s', () => {
    expect(pool.options.max).toBe(20);
    expect(pool.options.min).toBe(10);
    expect(pool.options.connectionTimeoutMillis).toBe(5_000);
  });
});

describe('isPoolNearCapacity', () => {
  it('não alerta quando o pool está tranquilo', () => {
    expect(isPoolNearCapacity({ totalCount: 5, idleCount: 5, waitingCount: 0 })).toBe(false);
  });

  it('alerta quando alguém já está esperando por uma conexão', () => {
    expect(isPoolNearCapacity({ totalCount: 3, idleCount: 0, waitingCount: 1 })).toBe(true);
  });

  it('alerta quando o total se aproxima do máximo, mesmo sem fila', () => {
    expect(isPoolNearCapacity({ totalCount: 16, idleCount: 0, waitingCount: 0 }, 20, 0.8)).toBe(true);
    expect(isPoolNearCapacity({ totalCount: 15, idleCount: 0, waitingCount: 0 }, 20, 0.8)).toBe(false);
  });
});

describe('startPoolMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('para de rodar depois que a função de parada é chamada', () => {
    const stop = startPoolMonitor(1_000);
    const before = vi.getTimerCount();

    stop();

    // clearInterval remove o timer da fila do relógio falso — se `stop` não
    // limpasse o interval de verdade, o timer continuaria agendado
    expect(vi.getTimerCount()).toBeLessThan(before);
  });
});
