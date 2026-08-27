import { defineConfig } from 'drizzle-kit'

export default defineConfig({
    dialect: 'postgresql',
    schema: './web/src/db/index.ts',
    out: './web/drizzle',
    schemaFilter: ['rentnerproxy'],
    migrations: {
        schema: 'drizzle',
        table: '__drizzle_migrations',
    },
})
