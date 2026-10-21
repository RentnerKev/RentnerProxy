import type { ProxyHttpSettings } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import type { ProxyConfigEditorHandlers } from './proxy-config-editor.types.ts'

export interface ProxyConfigEditorConflictProps {
    readonly settings: ProxyHttpSettings
    readonly latest: ProxyHttpSettings | null
    readonly busy: boolean
    readonly global: boolean
    readonly confirmationOpen: boolean
    readonly handler: Pick<
        ProxyConfigEditorHandlers,
        'reviewLatest' | 'keepDraft' | 'useSaved' | 'acceptDraft' | 'setConflictConfirmationOpen'
    >
}
