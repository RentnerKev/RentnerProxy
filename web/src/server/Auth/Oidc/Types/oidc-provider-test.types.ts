import type { OidcProviderDependencies } from './oidc-provider.types.ts'
import type { OidcClientConfiguration } from './oidc.types.ts'
import type {
    OidcProviderTestResult,
    TestOidcProviderInput,
} from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'

export interface OidcProviderTestDependencies extends Pick<
    OidcProviderDependencies,
    'session' | 'transaction' | 'authorize' | 'lock' | 'limit'
> {
    origin(): string | null
    verify(configuration: OidcClientConfiguration): Promise<void>
}
export interface OidcProviderTestResponseDependencies {
    origin(): string | null
    authorize(): Promise<unknown>
    test(input: TestOidcProviderInput): Promise<OidcProviderTestResult>
}
