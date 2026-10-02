import type {
    ProxyConfigEditorHandlers,
    ProxyGlobalConfigEditorState,
} from '../../../Types/proxy-config-editor.types.ts'

export interface ProxyGlobalConfigEditorLogicResult {
    readonly state: ProxyGlobalConfigEditorState
    readonly handler: ProxyConfigEditorHandlers
}
