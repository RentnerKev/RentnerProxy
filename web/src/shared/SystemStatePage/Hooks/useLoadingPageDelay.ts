import { useEffect, useState } from 'react'

export default function useLoadingPageDelay(): boolean {
    const [showLoading, setShowLoading] = useState(false)

    useEffect(() => {
        const timeout = setTimeout(() => setShowLoading(true), 1_000)
        return () => clearTimeout(timeout)
    }, [])

    return showLoading
}
