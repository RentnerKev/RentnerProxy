export interface MigrationOptions {
    readonly databaseUrl?: string
    readonly migrationsFolder?: string
}

export type MigrationFailurePhase =
    | 'database connection'
    | 'schema migration'
    | 'authorization registry'
