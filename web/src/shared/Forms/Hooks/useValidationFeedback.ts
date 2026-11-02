import { useCallback, useState } from 'react'
import type { ValidationFeedbackResult } from '../Types/validation-feedback.types.ts'

/** Tracks completed validation events independently of TanStack's structurally shared error arrays. */
export default function useValidationFeedback() {
    const [validationEpochs, setValidationEpochs] = useState<Readonly<Record<string, number>>>({})
    const handleValidationCompleted = useCallback((names: readonly string[]) => {
        setValidationEpochs((current) => {
            const next = { ...current }
            for (const name of names) next[name] = (current[name] ?? 0) + 1
            return next
        })
    }, [])
    return {
        state: { validationEpochs },
        handler: { handleValidationCompleted },
    } satisfies ValidationFeedbackResult
}
