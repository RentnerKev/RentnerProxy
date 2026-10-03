import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Annotation, Compartment, EditorState } from '@codemirror/state'
import { html } from '@codemirror/lang-html'
import { basicSetup, EditorView } from 'codemirror'

import { HTML_EDITOR_COLOR_PRESETS } from '@/config/html-editor.config.ts'
import type { HtmlEditorColorPreset } from '@/config/Types/html-editor-config.types.ts'
import { formatDefaultSiteHtmlHandler } from '@/features/DefaultSite/middleware.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { createHtmlEditorTheme } from '../editorTheme.ts'
import type {
    HtmlSourceEditorLogicResult,
    HtmlSourceEditorProps,
} from '../Types/html-source-editor.types.ts'

const externalUpdate = Annotation.define<boolean>()

export function useHtmlSourceEditorLogic(
    props: HtmlSourceEditorProps,
): HtmlSourceEditorLogicResult {
    const { t } = useTranslationStore()
    const container = useRef<HTMLDivElement | null>(null)
    const editor = useRef<EditorView | null>(null)
    const latest = useRef(props)
    const mounted = useRef(false)
    const formatting = useRef(false)
    const [colorPreset, setColorPreset] = useState<HtmlEditorColorPreset>('rentnerproxy')
    const [isFormatting, setIsFormatting] = useState(false)
    const [formatError, setFormatError] = useState<string | null>(null)
    const [configuration] = useState(() => ({
        theme: new Compartment(),
        editable: new Compartment(),
        attributes: new Compartment(),
    }))

    useLayoutEffect(() => {
        latest.current = props
    })

    useEffect(() => {
        if (!container.current) return
        mounted.current = true
        const view = new EditorView({
            parent: container.current,
            state: EditorState.create({
                doc: latest.current.value,
                extensions: [
                    basicSetup,
                    html(),
                    EditorView.lineWrapping,
                    configuration.theme.of(createHtmlEditorTheme('rentnerproxy')),
                    configuration.editable.of([]),
                    configuration.attributes.of([]),
                    EditorView.updateListener.of((update) => {
                        if (
                            update.docChanged &&
                            !latest.current.disabled &&
                            !update.transactions.some((transaction) =>
                                transaction.annotation(externalUpdate),
                            )
                        ) {
                            setFormatError(null)
                            latest.current.onChange(update.state.doc.toString())
                        }
                    }),
                    EditorView.domEventHandlers({
                        blur: () => latest.current.onBlur(),
                    }),
                ],
            }),
        })
        editor.current = view
        return () => {
            mounted.current = false
            editor.current = null
            view.destroy()
        }
    }, [configuration])

    useEffect(() => {
        const view = editor.current
        if (!view) return
        const current = view.state.doc.toString()
        if (current !== props.value) {
            view.dispatch({
                changes: { from: 0, to: current.length, insert: props.value },
                annotations: externalUpdate.of(true),
            })
            setFormatError(null)
        }
    }, [props.value])

    useEffect(() => {
        editor.current?.dispatch({
            effects: [
                configuration.editable.reconfigure([
                    EditorState.readOnly.of(props.disabled),
                    EditorView.editable.of(!props.disabled),
                ]),
                configuration.attributes.reconfigure(
                    EditorView.contentAttributes.of({
                        id: props.id,
                        role: 'textbox',
                        'aria-label': t('defaultSite.html'),
                        'aria-multiline': 'true',
                        'aria-readonly': String(props.disabled),
                        'aria-invalid': String(props.invalid),
                        'aria-describedby': props.describedBy,
                        tabindex: '0',
                        spellcheck: 'false',
                        autocapitalize: 'off',
                        autocorrect: 'off',
                    }),
                ),
            ],
        })
    }, [configuration, props.id, props.disabled, props.invalid, props.describedBy, t])

    useEffect(() => {
        editor.current?.dispatch({
            effects: configuration.theme.reconfigure(createHtmlEditorTheme(colorPreset)),
        })
    }, [configuration, colorPreset])

    async function handleFormat() {
        const view = editor.current
        if (!view || latest.current.disabled || formatting.current || !view.state.doc.length) return
        const source = view.state.doc.toString()
        formatting.current = true
        setIsFormatting(true)
        setFormatError(null)
        try {
            const result = await formatDefaultSiteHtmlHandler({ data: source })
            if (!mounted.current || latest.current.disabled || editor.current !== view) return
            if (!result.success) {
                setFormatError(t(result.message))
                return
            }
            if (view.state.doc.toString() !== source) {
                setFormatError(t('defaultSite.editor.formatChanged'))
                return
            }
            if (result.html !== source) {
                view.dispatch({
                    changes: { from: 0, to: source.length, insert: result.html },
                    userEvent: 'input.format',
                })
            }
        } catch {
            if (mounted.current && editor.current === view) {
                setFormatError(t('defaultSite.editor.formatFailed'))
            }
        } finally {
            formatting.current = false
            if (mounted.current) setIsFormatting(false)
        }
    }

    function handleColorChange(value: string) {
        const preset = HTML_EDITOR_COLOR_PRESETS.find((candidate) => candidate === value)
        if (preset) setColorPreset(preset)
    }

    return {
        state: {
            colorPreset,
            colorOptions: HTML_EDITOR_COLOR_PRESETS.map((value) => ({
                value,
                label: t(`defaultSite.editor.presets.${value}`),
            })),
            isFormatting,
            formatError,
            canFormat: !props.disabled && !isFormatting && props.value.trim().length > 0,
        },
        handler: { handleColorChange, handleFormat },
        refs: { container },
    }
}
