import 'dotenv/config';
import Fastify from 'fastify';

const PORT = Number(process.env.PORT ?? 3000);

const app = Fastify({
  logger: true,
});

app.get('/', async () => {
  return { ok: true, service: 'arara' };
});

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`ARARA listening on port ${PORT}`);
  })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
