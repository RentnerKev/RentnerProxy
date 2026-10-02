import type { SystemAccentState } from './Types/system-accent.types.ts'
import { createContext, useContext } from 'react'

export const SystemAccentContext = createContext<SystemAccentState | null>(null)

export function useSystemAccent(): SystemAccentState {
    const value = useContext(SystemAccentContext)
    if (!value) throw new Error('System accent context is unavailable')
    return value
}
