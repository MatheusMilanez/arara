import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const PORT = 3999;

function waitFor(predicate: () => boolean, timeoutMs: number, describeFailure: () => string): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (predicate()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`Timeout: ${describeFailure()}`));
      }
    }, 100);
  });
}

// sobe o processo real (não importa server.ts no processo de teste, porque
// ele registra handlers de SIGTERM/SIGINT e chama process.exit — importar
// isso dentro do Vitest colidiria com o processo do próprio test runner)
describe('server bootstrap (smoke test)', () => {
  it('sobe, responde em /api/v1/health e encerra de forma limpa no SIGTERM', async () => {
    // roda via `node --import tsx` (não `npx tsx`) pra evitar o processo
    // intermediário do npx/shell, que no Windows perdia o stdout do filho
    const child: ChildProcessWithoutNullStreams = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      env: { ...process.env, PORT: String(PORT) },
      cwd: process.cwd(),
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      await waitFor(
        () => stdout.includes(`listening on port ${PORT}`),
        15_000,
        () => `server não subiu a tempo. stdout=${stdout} stderr=${stderr}`,
      );

      const res = await fetch(`http://127.0.0.1:${PORT}/api/v1/health`);
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as { status: string };
      expect(['ok', 'error']).toContain(body.status);

      const exitCode = await new Promise<number | null>((resolve) => {
        child.once('exit', (code) => resolve(code));
        child.kill('SIGTERM');
      });

      // no Windows, child.kill('SIGTERM') derruba o processo direto (sem
      // POSIX signals de verdade, o handler process.on('SIGTERM') do
      // server.ts nunca chega a rodar) — só o CI (ubuntu) prova o shutdown
      // gracioso de fato; aqui só garantimos que o processo não fica pendurado
      if (process.platform === 'win32') {
        expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      } else {
        expect(exitCode).toBe(0);
      }
    } finally {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGKILL');
      }
    }
  }, 30_000);
});
