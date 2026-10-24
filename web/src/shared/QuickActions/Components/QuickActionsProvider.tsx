import { QuickActionsContext, useQuickActionsProviderLogic } from '../Hooks/useQuickActions.ts'
import type { QuickActionsProviderProps } from '../Types/quick-actions.types.ts'

export default function QuickActionsProvider({ children, permissions }: QuickActionsProviderProps) {
    const { state } = useQuickActionsProviderLogic(permissions)
    return <QuickActionsContext value={state.value}>{children}</QuickActionsContext>
}
