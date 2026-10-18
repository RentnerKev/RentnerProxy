import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ProxyConfigEditorTabsProps } from '../Types/proxy-config-editor-tabs.types.ts'
export default function ProxyConfigEditorTabs({
    activeTab,
    disabled,
    onTabChange,
}: ProxyConfigEditorTabsProps) {
    const { t } = useTranslationStore()
    return (
        <div className="flex flex-wrap gap-1">
            {(['edit', 'active'] as const).map((tab) => (
                <button
                    key={tab}
                    type="button"
                    className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-transparent text-muted enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                    onClick={() => onTabChange(tab)}
                    aria-pressed={activeTab === tab}
                    disabled={disabled}
                >
                    {t(`admin.proxyHosts.config.${tab === 'edit' ? 'settings' : tab}`)}
                </button>
            ))}
        </div>
    )
}
