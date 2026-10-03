import { CustomSelect } from '@rentnerkev/select/select'
import { Braces, ListIndentIncrease } from 'lucide-react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { useHtmlSourceEditorLogic } from './Hooks/useHtmlSourceEditorLogic.ts'
import type { HtmlSourceEditorProps } from './Types/html-source-editor.types.ts'

export default function HtmlSourceEditor(props: HtmlSourceEditorProps) {
    const { t } = useTranslationStore()
    const {
        state,
        handler,
        refs: { container: editorContainerRef },
    } = useHtmlSourceEditorLogic(props)
    return (
        <div className="min-w-0 w-full">
            <div
                className="min-w-0 overflow-hidden rounded-xl border border-border-strong bg-surface-raised [--editor-attribute:#7c3aed] [--editor-keyword:#005fb8] [--editor-number:#0f766e] [--editor-string:#b45309] focus-within:border-accent-ring dark:[--editor-attribute:#c4b5fd] dark:[--editor-keyword:#80c7fa] dark:[--editor-number:#5eead4] dark:[--editor-string:#fcd34d]"
                data-color-preset={state.colorPreset}
            >
                <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2.5">
                    <span className="inline-flex items-center gap-2 text-xs font-bold text-muted">
                        <Braces className="size-4" aria-hidden="true" />
                        HTML
                    </span>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                        <label
                            htmlFor={`${props.id}-colors`}
                            className="text-xs font-medium text-muted"
                        >
                            {t('defaultSite.editor.colors')}
                        </label>
                        <div className="w-36">
                            <CustomSelect
                                id={`${props.id}-colors`}
                                aria-label={t('defaultSite.editor.colors')}
                                value={state.colorPreset}
                                options={state.colorOptions}
                                onValueChange={handler.handleColorChange}
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => void handler.handleFormat()}
                            disabled={!state.canFormat}
                            aria-busy={state.isFormatting}
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-xs font-bold text-ink-soft transition-colors enabled:hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:opacity-55"
                        >
                            <ListIndentIncrease className="size-4" aria-hidden="true" />
                            {t(
                                state.isFormatting
                                    ? 'defaultSite.editor.formatting'
                                    : 'defaultSite.editor.format',
                            )}
                        </button>
                    </div>
                </div>
                <div ref={editorContainerRef} className="min-h-90 min-w-0" />
            </div>
            {state.formatError ? (
                <p role="alert" className="mt-2 text-sm text-danger-text">
                    {state.formatError}
                </p>
            ) : null}
        </div>
    )
}
