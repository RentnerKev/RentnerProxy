import { defineConfig } from 'drizzle-kit'

export default defineConfig({
    dialect: 'postgresql',
    schema: './web/src/db/schema.ts',
    out: './web/drizzle',
    schemaFilter: ['rentnerproxy'],
    migrations: {
        schema: 'drizzle',
        table: '__drizzle_migrations',
    },
})
