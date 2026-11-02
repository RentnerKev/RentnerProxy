import type { OidcProviderConfiguration } from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'
import type { CurrentSession } from '@/server/Auth/Core/Types/auth-service.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type { SaveOidcProvidersInput } from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'

export interface StoredOidcProvider extends OidcProviderConfiguration {
    readonly revision: number
    readonly clientSecret: { ciphertext: string; iv: string }
}
export interface StoredOidcSettings {
    readonly version: 1
    readonly revision: number
    readonly providers: StoredOidcProvider[]
}

export interface OidcProviderDependencies {
    session(): Promise<CurrentSession>
    transaction<T>(run: (transaction: AuthTransaction) => Promise<T>): Promise<T>
    authorize(transaction: AuthTransaction, session: CurrentSession): Promise<void>
    validateUser(transaction: AuthTransaction, userId: string): Promise<void>
    read(transaction: AuthTransaction): Promise<StoredOidcSettings>
    lock(transaction: AuthTransaction): Promise<StoredOidcSettings>
    write(transaction: AuthTransaction, settings: StoredOidcSettings): Promise<void>
    build(current: StoredOidcSettings, input: SaveOidcProvidersInput): Promise<StoredOidcSettings>
    limit(userId: string): Promise<void>
    audit(transaction: AuthTransaction, actorId: string): Promise<void>
    publish(): void
}
