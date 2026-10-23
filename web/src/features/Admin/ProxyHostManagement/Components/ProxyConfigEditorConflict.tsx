import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import type { ProxyConfigEditorConflictProps } from '../Types/proxy-config-editor-conflict.types.ts'

const FIELDS = [
    ['clientMaxBodySizeBytes', 'fieldClientMaxBodySizeBytes', 'bytes'],
    ['proxyConnectTimeoutSeconds', 'fieldProxyConnectTimeoutSeconds', 'seconds'],
    ['proxyReadTimeoutSeconds', 'fieldProxyReadTimeoutSeconds', 'seconds'],
    ['proxySendTimeoutSeconds', 'fieldProxySendTimeoutSeconds', 'seconds'],
    ['sendTimeoutSeconds', 'fieldSendTimeoutSeconds', 'seconds'],
    ['keepaliveTimeoutSeconds', 'fieldKeepaliveTimeoutSeconds', 'seconds'],
] as const

export default function ProxyConfigEditorConflict({
    settings,
    latest,
    busy,
    global,
    confirmationOpen,
    handler,
}: ProxyConfigEditorConflictProps) {
    const { t } = useTranslationStore()
    return (
        <section
            className="grid min-w-0 gap-3 rounded-xl border border-border bg-surface-subtle p-3"
            aria-label={t('admin.proxyHosts.config.conflict.title')}
        >
            <p role="alert" className="m-0 text-sm text-danger-text">
                {t('admin.proxyHosts.config.conflict.description')}
            </p>
            <button
                type="button"
                className={buttonClassName('secondary')}
                disabled={busy}
                onClick={() => void handler.reviewLatest()}
            >
                {t('admin.proxyHosts.config.conflict.reviewLatest')}
            </button>
            {latest ? (
                <>
                    <div className="min-w-0 overflow-x-auto">
                        <table className="w-full text-left text-sm text-ink-soft">
                            <thead>
                                <tr>
                                    <th scope="col">{t('admin.proxyHosts.config.settings')}</th>
                                    <th scope="col">
                                        {t('admin.proxyHosts.config.conflict.savedValues')}
                                    </th>
                                    <th scope="col">
                                        {t('admin.proxyHosts.config.conflict.draftValues')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <th scope="row" className="py-2 pr-3 font-medium">
                                        {t('admin.proxyHosts.config.compression.title')}
                                    </th>
                                    <td className="pr-3">
                                        {t(
                                            `admin.proxyHosts.config.compression.${latest.responseCompression ?? (global ? 'default' : 'inherit')}`,
                                        )}
                                    </td>
                                    <td>
                                        {t(
                                            `admin.proxyHosts.config.compression.${settings.responseCompression ?? (global ? 'default' : 'inherit')}`,
                                        )}
                                    </td>
                                </tr>
                                {!global ? (
                                    <tr>
                                        <th scope="row">
                                            {t('admin.proxyHosts.browserCache.title')}
                                        </th>
                                        <td className="max-w-48 break-all">
                                            {JSON.stringify(latest.browserCache ?? null)}
                                        </td>
                                        <td className="max-w-48 break-all">
                                            {JSON.stringify(settings.browserCache ?? null)}
                                        </td>
                                    </tr>
                                ) : null}
                                {FIELDS.slice(0, global ? 6 : 4).map(([key, label, unit]) => (
                                    <tr key={key}>
                                        <th scope="row" className="py-2 pr-3 font-medium">
                                            {t(`admin.proxyHosts.config.${label}`)}
                                        </th>
                                        <td className="pr-3">
                                            {latest[key] === undefined
                                                ? t('admin.proxyHosts.config.conflict.defaultValue')
                                                : `${latest[key]} ${t(`admin.proxyHosts.config.${unit}`)}`}
                                        </td>
                                        <td>
                                            {settings[key] === undefined
                                                ? t('admin.proxyHosts.config.conflict.defaultValue')
                                                : `${settings[key]} ${t(`admin.proxyHosts.config.${unit}`)}`}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="m-0 text-sm text-muted">
                        {t('admin.proxyHosts.config.conflict.keepDescription')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className={buttonClassName('primary')}
                            disabled={busy}
                            onClick={handler.keepDraft}
                        >
                            {t('admin.proxyHosts.config.conflict.keepDraft')}
                        </button>
                        <button
                            type="button"
                            className={buttonClassName('secondary')}
                            disabled={busy}
                            onClick={handler.useSaved}
                        >
                            {t('admin.proxyHosts.config.conflict.useSaved')}
                        </button>
                    </div>
                </>
            ) : null}
            {confirmationOpen ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setConflictConfirmationOpen}
                    title={t('admin.proxyHosts.config.conflict.overwriteTitle')}
                    description={t('admin.proxyHosts.config.conflict.overwriteDescription')}
                    confirmLabel={t('admin.proxyHosts.config.conflict.overwriteConfirm')}
                    destructive
                    onConfirm={handler.acceptDraft}
                />
            ) : null}
        </section>
    )
}
