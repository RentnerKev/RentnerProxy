import { useEffect, useState } from 'react'

export default function useFragmentToken() {
    const [token, setToken] = useState<string | null | undefined>(undefined)

    useEffect(() => {
        const parameters = new URLSearchParams(window.location.hash.slice(1))
        const fragmentToken = parameters.get('token')

        queueMicrotask(() => setToken(fragmentToken?.trim() || null))

        if (window.location.hash) {
            window.history.replaceState(
                null,
                '',
                `${window.location.pathname}${window.location.search}`,
            )
        }
    }, [])

    return token
}
