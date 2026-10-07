import { useEffect, useState } from 'react'

export default function useToastPortalTarget() {
    const [target, setTarget] = useState<HTMLElement | null>(() =>
        typeof document === 'undefined' ? null : document.body,
    )

    useEffect(() => {
        const updateTarget = () => {
            const hosts = [...document.querySelectorAll<HTMLElement>('[data-modal-toast-host]')]
            const activeHost = hosts.findLast(
                (host) => host.closest('[role="dialog"]')?.getAttribute('data-state') === 'open',
            )
            const next = activeHost ?? document.body
            setTarget((current) => (current === next ? current : next))
        }
        const observer = new MutationObserver(updateTarget)
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-state'],
        })
        updateTarget()
        return () => observer.disconnect()
    }, [])

    return target
}
