import { createContext, useContext } from 'react'

export interface SystemAccentState {
    readonly accentColor: string
    readonly setAccentColor: (color: string) => void
}

export const SystemAccentContext = createContext<SystemAccentState | null>(null)

export function useSystemAccent(): SystemAccentState {
    const value = useContext(SystemAccentContext)
    if (!value) throw new Error('System accent context is unavailable')
    return value
}
