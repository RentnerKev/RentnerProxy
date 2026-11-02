import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useUpstreamAvailabilityLogic from '../Hooks/useUpstreamAvailabilityLogic.ts'
import type { UpstreamAvailabilityProps } from '../Types/upstream-availability.types.ts'

export default function UpstreamAvailability(props: UpstreamAvailabilityProps) {
    const { t } = useTranslationStore()
    const { state } = useUpstreamAvailabilityLogic(props)
    if (!state.visible) return null
    return (
        <section
            className="grid gap-2 rounded-xl border border-border bg-surface-subtle p-3"
            aria-label={t('admin.proxyHosts.upstreamHealth.title')}
        >
            <h3 className="m-0 text-sm font-bold">{t('admin.proxyHosts.upstreamHealth.title')}</h3>
            <output
                data-upstream-availability={state.availability}
                className="m-0 text-sm font-bold text-ink-soft"
            >
                {t(`admin.proxyHosts.upstreamHealth.${state.availability}`)}
            </output>
            {state.reason ? (
                <p className="m-0 text-xs text-muted">
                    {t(`admin.proxyHosts.upstreamHealth.${state.reason}Hint`)}
                </p>
            ) : null}
            <ul className="m-0 grid list-none gap-2 p-0">
                {state.members.map((member) => (
                    <li key={member.index} className="flex flex-wrap justify-between gap-2 text-xs">
                        <span className="wrap-anywhere font-mono">{member.target}</span>
                        <span data-upstream-member-state={member.state}>
                            {t(`admin.proxyHosts.upstreamHealth.member.${member.state}`)}
                        </span>
                    </li>
                ))}
            </ul>
            <p className="m-0 text-xs leading-relaxed text-muted">
                {t('admin.proxyHosts.upstreamHealth.hint')}
            </p>
        </section>
    )
}
