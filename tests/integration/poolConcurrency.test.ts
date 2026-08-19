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

// ARARA-401: o teste acima prova que uma rajada curta enfileira e resolve —
// não prova o que acontece quando a fila em si não dá vazão a tempo. Aqui
// as 20 conexões do pool ficam seguradas por queries lentas de propósito,
// forçando uma 21ª query a esperar mais que connectionTimeoutMillis (5s).
describe('pool esgotado por tempo suficiente pra estourar o timeout (ARARA-401)', () => {
  it('a query excedente falha dentro do connectionTimeoutMillis, sem travar — e o pool volta ao normal depois', async () => {
    const holders = Array.from({ length: 20 }, () => pool.query('SELECT pg_sleep(6)'));
    // dá um instante pro pool realmente preencher as 20 conexões antes de
    // disparar a 21ª — sem isso, ela poderia pegar uma conexão livre por
    // sorte de timing, e o teste não provaria nada
    await new Promise((resolve) => setTimeout(resolve, 200));

    const start = performance.now();
    await expect(pool.query('SELECT 1')).rejects.toThrow(/timeout/i);
    const elapsedMs = performance.now() - start;

    // 5s configurados + folga pra jitter do CI — o ponto é "não ficou
    // pendurado esperando pra sempre", não um número exato de ms
    expect(elapsedMs).toBeLessThan(6000);

    // as 20 seguradas ainda vão liberar (pg_sleep termina em 6s) — o pool
    // não pode ter ficado num estado quebrado só porque uma espera estourou
    await Promise.allSettled(holders);
    await expect(pool.query('SELECT 1')).resolves.toBeDefined();
  }, 20_000);
});
