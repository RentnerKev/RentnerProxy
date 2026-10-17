import { QueryClientProvider } from '@tanstack/react-query'
import { FlaskConical, RotateCcw } from 'lucide-react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import DdnsPage from '../index.tsx'
import type { DdnsPageProps } from '../Types/ddns-ui.types.ts'
import useDdnsDevelopmentLogic from './Hooks/useDdnsDevelopmentLogic.ts'

export default function DdnsDevelopment(props: DdnsPageProps) {
    const { state, handler } = useDdnsDevelopmentLogic(props)
    const { t } = useTranslationStore()
    return (
        <>
            <div className="mb-5 flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    aria-pressed={state.demoEnabled}
                    onClick={handler.toggleDemo}
                    className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border-strong bg-surface-raised px-3 text-sm font-bold text-ink-soft hover:bg-surface-hover"
                >
                    <FlaskConical aria-hidden="true" className="size-4" />
                    {t(state.demoEnabled ? 'admin.ddns.demo.hide' : 'admin.ddns.demo.show')}
                </button>
                {state.demoEnabled ? (
                    <>
                        <output className="text-xs font-bold text-accent-ring">
                            {t('admin.ddns.demo.description')}
                        </output>
                        <button
                            type="button"
                            onClick={handler.resetDemo}
                            className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs font-bold text-muted hover:bg-surface-hover"
                        >
                            <RotateCcw aria-hidden="true" className="size-3.5" />
                            {t('admin.ddns.demo.reset')}
                        </button>
                    </>
                ) : null}
            </div>
            <QueryClientProvider client={state.queryClient}>
                <DdnsPage
                    key={state.sessionKey}
                    permissions={props.permissions}
                    api={state.api}
                    liveEnabled={!state.demoEnabled && props.liveEnabled !== false}
                />
            </QueryClientProvider>
        </>
    )
}
