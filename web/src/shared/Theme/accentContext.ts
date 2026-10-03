import type { AccentState } from './Types/accent.types.ts'
import { createContext, useContext } from 'react'

export const AccentContext = createContext<AccentState | null>(null)

export function useAccent(): AccentState {
    const value = useContext(AccentContext)
    if (!value) throw new Error('Accent context is unavailable')
    return value
}
