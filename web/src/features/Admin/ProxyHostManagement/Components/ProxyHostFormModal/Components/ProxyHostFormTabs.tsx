import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ProxyHostFormTabsProps } from '../Types/form-sections.types.ts'

export default function ProxyHostFormTabs({
    activeTab,
    formId,
    tabs,
    invalidTabs,
    isPending,
    setActiveTab,
    handleTabKeyDown,
}: ProxyHostFormTabsProps) {
    const { t } = useTranslationStore()
    return (
        <div
            role="tablist"
            aria-label={t('admin.proxyHosts.form.tabs.label')}
            className="flex gap-1 overflow-x-auto py-1"
        >
            {tabs.map((tab) => (
                <button
                    key={tab}
                    id={`${formId}-tab-${tab}`}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    aria-controls={`${formId}-panel-${tab}`}
                    aria-describedby={invalidTabs.includes(tab) ? `${formId}-tab-error` : undefined}
                    data-invalid={invalidTabs.includes(tab)}
                    tabIndex={activeTab === tab ? 0 : -1}
                    disabled={isPending}
                    className={`min-h-10 flex-1 shrink-0 cursor-pointer whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${activeTab === tab ? 'border-accent-border bg-accent-muted text-accent-ring' : 'border-transparent text-muted hover:border-border-strong hover:bg-surface-hover hover:text-ink'}`}
                    onClick={() => setActiveTab(tab)}
                    onKeyDown={(event) => handleTabKeyDown(event, tab)}
                >
                    {t(`admin.proxyHosts.form.tabs.${tab}`)}
                    {invalidTabs.includes(tab) ? (
                        <span
                            aria-hidden="true"
                            className="ml-2 inline-flex size-4 items-center justify-center rounded-full bg-danger-bg text-xs font-extrabold text-danger-text"
                        >
                            !
                        </span>
                    ) : null}
                </button>
            ))}
            {invalidTabs.length > 0 ? (
                <span id={`${formId}-tab-error`} className="sr-only">
                    {t('admin.proxyHosts.form.tabs.hasErrors')}
                </span>
            ) : null}
        </div>
    )
}
