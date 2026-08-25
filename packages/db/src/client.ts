import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client/client';

const createClient = () => {
  // Fail-fast con mensaje claro: el driver adapter (@prisma/adapter-pg) NO aborta
  // si falta DATABASE_URL — un connectionString vacío degrada a un error críptico
  // de pg. Lanzar aquí lo hace obvio en el boot.
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL no está configurada — revisa el .env (ver .env.example)'
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });
};

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createClient> | undefined;
};

function getClient() {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

// Instanciación lazy vía Proxy: createClient() (que hace fail-fast si falta
// DATABASE_URL) NO corre al importar el módulo, sino en el primer acceso real
// a `prisma`. Así un consumidor que solo importa tipos no exige DATABASE_URL;
// el fail-fast salta cuando se va a tocar la DB de verdad.
export const prisma = new Proxy({} as ReturnType<typeof createClient>, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
