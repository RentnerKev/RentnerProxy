import {
    DOCKER_DISCOVERY_COMPOSE_EXAMPLE,
    DOCKER_DISCOVERY_NATIVE_EXAMPLE,
} from '@/config/docker-discovery.config.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { DiscoveryGuideProps } from '../Types/discovery-ui.types.ts'

export default function DiscoveryGuide({ onClose, onCopy }: DiscoveryGuideProps) {
    const { t } = useTranslationStore()
    return (
        <Modal
            open
            size="lg"
            onOpenChange={onClose}
            title={t('admin.dockerDiscovery.guide.title')}
            description={t('admin.dockerDiscovery.guide.description')}
            footer={
                <button
                    type="button"
                    onClick={onClose}
                    className="h-11 rounded-xl border border-border bg-control px-4 text-sm font-bold text-ink-soft"
                >
                    {t('common.closeDialog')}
                </button>
            }
        >
            <div className="grid min-w-0 gap-5 text-sm text-muted">
                <section className="grid min-w-0 gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-bold text-ink-soft">
                            {t('admin.dockerDiscovery.guide.appliance')}
                        </h3>
                        <button
                            type="button"
                            onClick={() => onCopy(false)}
                            className="min-h-9 rounded-lg border border-border px-3 font-bold text-ink-soft"
                        >
                            {t('admin.dockerDiscovery.actions.copy')}
                        </button>
                    </div>
                    <p>{t('admin.dockerDiscovery.guide.applianceHint')}</p>
                    <pre className="max-h-80 overflow-auto rounded-xl border border-border bg-control p-4 font-mono text-xs text-ink-soft">
                        <code>{DOCKER_DISCOVERY_COMPOSE_EXAMPLE}</code>
                    </pre>
                </section>
                <section className="grid min-w-0 gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-bold text-ink-soft">
                            {t('admin.dockerDiscovery.guide.native')}
                        </h3>
                        <button
                            type="button"
                            onClick={() => onCopy(true)}
                            className="min-h-9 rounded-lg border border-border px-3 font-bold text-ink-soft"
                        >
                            {t('admin.dockerDiscovery.actions.copy')}
                        </button>
                    </div>
                    <p>{t('admin.dockerDiscovery.guide.nativeHint')}</p>
                    <pre className="max-h-80 overflow-auto rounded-xl border border-border bg-control p-4 font-mono text-xs text-ink-soft">
                        <code>{DOCKER_DISCOVERY_NATIVE_EXAMPLE}</code>
                    </pre>
                </section>
                <p>{t('admin.dockerDiscovery.guide.references')}</p>
                <p>{t('admin.dockerDiscovery.guide.identity')}</p>
                <p>{t('admin.dockerDiscovery.guide.lifecycle')}</p>
                <p>{t('admin.dockerDiscovery.guide.limits')}</p>
            </div>
        </Modal>
    )
}
