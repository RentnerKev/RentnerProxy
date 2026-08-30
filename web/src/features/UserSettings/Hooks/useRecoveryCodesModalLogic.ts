import { useState } from 'react'

export default function useRecoveryCodesModalLogic(codes: ReadonlyArray<string> | null) {
    const [copied, setCopied] = useState(false)
    const copy = async () => {
        const currentCodes = codes
        if (!currentCodes) return
        try {
            await navigator.clipboard.writeText(currentCodes.join('\n'))
            setCopied(true)
        } catch {
            setCopied(false)
        }
    }
    return { state: { copied }, handler: { copy } }
}
