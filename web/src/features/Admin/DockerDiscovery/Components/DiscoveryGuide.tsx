import { Copy } from 'lucide-react'
import {
    DOCKER_DISCOVERY_GUIDE_EXAMPLES,
    DOCKER_DISCOVERY_OPTIONAL_LABELS,
    DOCKER_DISCOVERY_LABEL_EXAMPLE,
} from '@/config/docker-discovery.config.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { DiscoveryGuideProps } from '../Types/discovery-ui.types.ts'

export default function DiscoveryGuide({
    mode,
    onModeChange,
    onClose,
    onCopy,
}: DiscoveryGuideProps) {
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
                    className="min-h-11 rounded-xl border border-border bg-control px-4 py-2 text-sm font-bold text-ink-soft"
                >
                    {t('common.closeDialog')}
                </button>
            }
        >
            <div className="grid min-w-0 gap-5 text-sm text-muted">
                <fieldset className="grid min-w-0 gap-3">
                    <legend className="sr-only">
                        {t('admin.dockerDiscovery.guide.environment')}
                    </legend>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            aria-pressed={mode === 'native'}
                            onClick={() => onModeChange('native')}
                            className={`min-h-10 rounded-xl border px-3 font-bold ${mode === 'native' ? 'border-accent-border bg-accent-soft text-accent-ring' : 'border-border bg-control text-ink-soft'}`}
                        >
                            {t('admin.dockerDiscovery.guide.native')}
                        </button>
                        <button
                            type="button"
                            aria-pressed={mode === 'appliance'}
                            onClick={() => onModeChange('appliance')}
                            className={`min-h-10 rounded-xl border px-3 font-bold ${mode === 'appliance' ? 'border-accent-border bg-accent-soft text-accent-ring' : 'border-border bg-control text-ink-soft'}`}
                        >
                            {t('admin.dockerDiscovery.guide.appliance')}
                        </button>
                    </div>
                    <p className="text-xs">
                        {t(
                            `admin.dockerDiscovery.guide.${mode === 'native' ? 'nativeHint' : 'applianceHint'}`,
                        )}
                    </p>
                </fieldset>
                <ol className="grid min-w-0 list-none gap-5 p-0">
                    <li className="grid min-w-0 gap-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="font-bold text-ink-soft">
                                {t('admin.dockerDiscovery.guide.saveStep')}
                            </h3>
                            <button
                                type="button"
                                onClick={() => onCopy(mode, 'compose')}
                                className="min-h-9 rounded-lg border border-border px-3 font-bold text-ink-soft"
                            >
                                {t('admin.dockerDiscovery.guide.copyFile')}
                            </button>
                        </div>
                        <div className="grid gap-1 text-xs">
                            <code className="font-mono wrap-anywhere text-ink-soft">
                                {DOCKER_DISCOVERY_GUIDE_EXAMPLES[mode].fileName}
                            </code>
                            <p>{t('admin.dockerDiscovery.guide.fileHint')}</p>
                        </div>
                        <pre className="overflow-auto rounded-xl border border-border bg-control p-3 font-mono text-xs text-ink-soft">
                            <code>{DOCKER_DISCOVERY_LABEL_EXAMPLE}</code>
                        </pre>
                        <details className="min-w-0">
                            <summary className="cursor-pointer text-xs font-bold text-ink-soft">
                                {t('admin.dockerDiscovery.guide.composeFile')}
                            </summary>
                            <pre className="mt-3 max-h-64 overflow-auto rounded-xl border border-border bg-control p-3 font-mono text-xs text-ink-soft">
                                <code>{DOCKER_DISCOVERY_GUIDE_EXAMPLES[mode].compose}</code>
                            </pre>
                        </details>
                    </li>
                    <li className="grid min-w-0 gap-3">
                        <h3 className="font-bold text-ink-soft">
                            {t('admin.dockerDiscovery.guide.startStep')}
                        </h3>
                        <div className="flex min-w-0 items-start gap-2 rounded-xl border border-border bg-control p-3">
                            <code className="min-w-0 flex-1 font-mono text-xs wrap-anywhere text-ink-soft">
                                {DOCKER_DISCOVERY_GUIDE_EXAMPLES[mode].command}
                            </code>
                            <button
                                type="button"
                                aria-label={t('admin.dockerDiscovery.guide.copyCommand')}
                                onClick={() => onCopy(mode, 'command')}
                                className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-ink-soft hover:bg-control-hover"
                            >
                                <Copy size={15} aria-hidden="true" />
                            </button>
                        </div>
                    </li>
                    <li className="grid min-w-0 gap-3">
                        <h3 className="font-bold text-ink-soft">
                            {t('admin.dockerDiscovery.guide.connectStep')}
                        </h3>
                        <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-control p-3">
                            <code className="min-w-0 flex-1 font-mono text-xs wrap-anywhere text-ink-soft">
                                {DOCKER_DISCOVERY_GUIDE_EXAMPLES[mode].endpoint}
                            </code>
                            <button
                                type="button"
                                aria-label={t('admin.dockerDiscovery.guide.copyEndpoint')}
                                onClick={() => onCopy(mode, 'endpoint')}
                                className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-ink-soft hover:bg-control-hover"
                            >
                                <Copy size={15} aria-hidden="true" />
                            </button>
                        </div>
                        <p className="text-xs">{t('admin.dockerDiscovery.guide.connectHint')}</p>
                    </li>
                </ol>
                <details className="min-w-0 rounded-xl border border-border bg-control p-4">
                    <summary className="cursor-pointer font-bold text-ink-soft">
                        {t('admin.dockerDiscovery.guide.options')}
                    </summary>
                    <div className="mt-4 grid min-w-0 gap-3">
                        <pre className="overflow-auto rounded-lg bg-surface p-3 font-mono text-xs text-ink-soft">
                            <code>{DOCKER_DISCOVERY_OPTIONAL_LABELS}</code>
                        </pre>
                        <ul className="grid list-disc gap-2 pl-4 text-xs">
                            <li>{t('admin.dockerDiscovery.guide.references')}</li>
                            <li>{t('admin.dockerDiscovery.guide.identity')}</li>
                            <li>{t('admin.dockerDiscovery.guide.lifecycle')}</li>
                            <li>{t('admin.dockerDiscovery.guide.limits')}</li>
                        </ul>
                    </div>
                </details>
            </div>
        </Modal>
    )
}
