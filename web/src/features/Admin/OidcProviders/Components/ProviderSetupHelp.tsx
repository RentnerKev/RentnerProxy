import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

/** Keeps verified provider setup examples beside the exact deployment callback URL. */
export default function ProviderSetupHelp() {
    const { t } = useTranslationStore()
    return (
        <details className="mb-6 rounded-2xl border border-border bg-surface-subtle p-5">
            <summary className="cursor-pointer font-bold">{t('oidc.setupTitle')}</summary>
            <div className="mt-4 grid gap-4 text-sm">
                <p className="text-muted">{t('oidc.setupClient')}</p>
                <div className="grid gap-4 md:grid-cols-2">
                    <section className="grid content-start gap-2 rounded-xl border border-border p-4">
                        <h3 className="font-bold">{t('oidc.authentikName')}</h3>
                        <p className="text-muted">{t('oidc.setupAuthentik')}</p>
                        <a
                            href="https://docs.goauthentik.io/add-secure-apps/providers/oauth2/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-bold underline underline-offset-4"
                        >
                            {t('oidc.setupAuthentikDocs')}
                        </a>
                    </section>
                    <section className="grid content-start gap-2 rounded-xl border border-border p-4">
                        <h3 className="font-bold">{t('oidc.keycloakName')}</h3>
                        <p className="text-muted">{t('oidc.setupKeycloak')}</p>
                        <a
                            href="https://www.keycloak.org/securing-apps/oidc-layers"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-bold underline underline-offset-4"
                        >
                            {t('oidc.setupKeycloakDocs')}
                        </a>
                    </section>
                </div>
                <p className="text-muted">{t('oidc.setupGroups')}</p>
                <p>{t('oidc.setupVerify')}</p>
            </div>
        </details>
    )
}
