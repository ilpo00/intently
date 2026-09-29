/**
 * Medusa v2 runtime config.
 *
 * Reads .env (loaded by `loadEnv` below). Defaults are sane for local
 * dev and match the values setup.sh writes into .env.
 */

import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

export default defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    // Compose Postgres has no SSL; without this Medusa tries to negotiate it
    // and the connection fails. (Documented in the Medusa Docker guide.)
    databaseDriverOptions: { ssl: false, sslmode: 'disable' },
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS || 'http://localhost:3000',
      adminCors: process.env.ADMIN_CORS || 'http://localhost:9000',
      authCors: process.env.AUTH_CORS || 'http://localhost:9000',
      jwtSecret: process.env.JWT_SECRET || 'change-me-jwt',
      cookieSecret: process.env.COOKIE_SECRET || 'change-me-cookie',
    },
  },
  admin: {
    disable: false,
  },
})
