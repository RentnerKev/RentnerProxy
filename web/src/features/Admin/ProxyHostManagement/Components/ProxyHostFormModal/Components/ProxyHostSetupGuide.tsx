import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ProxyHostSetupGuideProps } from '../Types/proxy-host-form.types.ts'

export default function ProxyHostSetupGuide({
    guide,
    guideHeading,
    formId,
    toggleGuide,
    nextGuideStep,
    previousGuideStep,
}: ProxyHostSetupGuideProps) {
    const { t } = useTranslationStore()
    return (
        <section
            className="grid gap-3 rounded-xl border border-accent-border bg-surface-raised p-4 shell:col-span-full"
            aria-label={t('admin.proxyHosts.guide.title')}
        >
            <button
                type="button"
                className="flex min-h-11 items-center rounded-lg px-3 text-left text-sm font-bold text-accent-ring hover:bg-accent-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring"
                aria-expanded={guide.open}
                aria-controls={`${formId}-guide`}
                onClick={toggleGuide}
            >
                {t(guide.open ? 'admin.proxyHosts.guide.skip' : 'admin.proxyHosts.guide.open')}
            </button>
            {guide.open ? (
                <div id={`${formId}-guide`} className="grid gap-3 text-sm text-ink-soft">
                    <h3
                        ref={guideHeading}
                        tabIndex={-1}
                        className="font-bold focus-visible:outline-2 focus-visible:outline-accent-ring"
                    >
                        {guide.step + 1}/3 ·{' '}
                        {t(
                            guide.step === 0
                                ? 'admin.proxyHosts.guide.domainsTitle'
                                : guide.step === 1
                                  ? 'admin.proxyHosts.guide.upstreamTitle'
                                  : 'admin.proxyHosts.guide.tlsTitle',
                        )}
                    </h3>
                    {guide.step === 0 ? (
                        <>
                            <p>{t('admin.proxyHosts.guide.domainsHelp')}</p>
                            <p className="break-words">
                                {guide.domains || t('admin.proxyHosts.guide.emptyDomains')}
                            </p>
                            {guide.wildcard ? (
                                <p>{t('admin.proxyHosts.guide.wildcardHelp')}</p>
                            ) : null}
                        </>
                    ) : guide.step === 1 ? (
                        <>
                            <p>{t('admin.proxyHosts.guide.upstreamHelp')}</p>
                            <p className="break-all">{guide.upstream}</p>
                        </>
                    ) : (
                        <>
                            <p>{t('admin.proxyHosts.guide.tlsHelp')}</p>
                            <p>
                                {guide.requestNewCertificate
                                    ? t('admin.proxyHosts.guide.requested')
                                    : guide.certificateSelected
                                      ? t('admin.proxyHosts.guide.existing', {
                                            name:
                                                guide.certificateName ??
                                                t('admin.proxyHosts.guide.certificateUnavailable'),
                                        })
                                      : t('admin.proxyHosts.guide.noCertificate')}
                            </p>
                            {guide.certificateSource && !guide.requestNewCertificate ? (
                                <p>
                                    {t('admin.certificates.columns.source')}:{' '}
                                    {t(
                                        guide.certificateSource === 'manual'
                                            ? 'admin.certificates.source.manual'
                                            : 'admin.certificates.source.acme',
                                    )}
                                </p>
                            ) : null}
                            {guide.requestNewCertificate ? (
                                <p>
                                    {t(
                                        guide.challengeType === 'dns-01'
                                            ? 'admin.proxyHosts.guide.dnsHelp'
                                            : 'admin.proxyHosts.guide.httpHelp',
                                    )}
                                </p>
                            ) : null}
                            {guide.wildcard ? (
                                <p>{t('admin.proxyHosts.guide.wildcardHelp')}</p>
                            ) : null}
                            <p>{t('admin.proxyHosts.guide.resultHelp')}</p>
                            <p>{t('admin.proxyHosts.guide.failureHelp')}</p>
                        </>
                    )}
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className="inline-flex min-h-11 items-center rounded-lg px-3 font-bold text-accent-ring hover:bg-accent-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={guide.step === 0}
                            onClick={previousGuideStep}
                        >
                            {t('admin.proxyHosts.guide.previous')}
                        </button>
                        <button
                            type="button"
                            className="inline-flex min-h-11 items-center rounded-lg px-3 font-bold text-accent-ring hover:bg-accent-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={guide.step === 2}
                            onClick={nextGuideStep}
                        >
                            {t('admin.proxyHosts.guide.next')}
                        </button>
                    </div>
                </div>
            ) : null}
        </section>
    )
}
