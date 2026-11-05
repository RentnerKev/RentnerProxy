import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { getManagedDomainHref } from '@/lib/Domain/managedDomain.ts'
import type {
    ManagedDomainLinkLogicParams,
    ManagedDomainLinkLogicResult,
} from '../Types/managed-domain.types.ts'

export default function useManagedDomainLinkLogic({
    domain,
    scheme = 'https',
    allowLinks = true,
    onClick,
    onKeyDown,
    onPointerDown,
}: ManagedDomainLinkLogicParams): ManagedDomainLinkLogicResult {
    const { t } = useTranslationStore()
    return {
        state: {
            href: allowLinks ? getManagedDomainHref(domain, scheme) : null,
            ariaLabel: t('common.openDomainInNewTab', { domain }),
        },
        handler: {
            handleClick: (event) => {
                event.stopPropagation()
                onClick?.(event)
            },
            handleKeyDown: (event) => {
                event.stopPropagation()
                onKeyDown?.(event)
            },
            handlePointerDown: (event) => {
                event.stopPropagation()
                onPointerDown?.(event)
            },
        },
    }
}
