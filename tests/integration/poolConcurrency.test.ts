import { describe, expect, it } from 'vitest';
import { pool } from '../../src/database/client.js';

// ARARA-211: prova a definição de pronto do ticket — o pool (max=20) precisa
// aguentar mais que 20 operações concorrentes sem estourar, só enfileirando
// o excedente.
describe('pool sob carga concorrente (ARARA-211)', () => {
  it('resolve 30 queries disparadas ao mesmo tempo sem esgotar o pool', async () => {
    const queries = Array.from({ length: 30 }, (_, i) => pool.query('SELECT $1::int AS n', [i]));

    const results = await Promise.allSettled(queries);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  }, 15_000);
});
