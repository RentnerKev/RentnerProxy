import { useEffect, useRef, useState } from 'react'

export default function useFragmentToken() {
    const [token, setToken] = useState<string | null | undefined>(undefined)
    const hasReadFragment = useRef(false)

    useEffect(() => {
        const captureFragmentToken = (hash: string, allowMissing: boolean) => {
            const parameters = new URLSearchParams(hash.slice(1))
            const fragmentToken = parameters.get('token')
            const nextToken = fragmentToken?.trim() || null

            if (nextToken || allowMissing) {
                queueMicrotask(() => setToken(nextToken))
            }

            if (window.location.hash) {
                window.history.replaceState(
                    null,
                    '',
                    `${window.location.pathname}${window.location.search}`,
                )
            }
        }

        const handleHashChange = (event: HashChangeEvent) => {
            const hash = event.newURL ? new URL(event.newURL).hash : window.location.hash
            captureFragmentToken(hash, false)
        }

        if (!hasReadFragment.current) {
            hasReadFragment.current = true
            captureFragmentToken(window.location.hash, true)
        }

        window.addEventListener('hashchange', handleHashChange)

        return () => {
            window.removeEventListener('hashchange', handleHashChange)
        }
    }, [])

    return token
}
