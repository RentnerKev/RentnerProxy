import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from 'codemirror'
import { tags } from '@lezer/highlight'
import { HTML_EDITOR_COLORS } from '@/config/html-editor.config.ts'
import type { HtmlEditorColorPreset } from '@/config/Types/html-editor-config.types.ts'

export function createHtmlEditorTheme(preset: HtmlEditorColorPreset) {
    const colors = HTML_EDITOR_COLORS[preset]
    return [
        EditorView.theme(
            {
                '&': {
                    backgroundColor: colors.background,
                    color: colors.foreground,
                    height: '360px',
                },
                '&.cm-focused': { outline: 'none' },
                '.cm-scroller': {
                    fontFamily: "Consolas, 'Liberation Mono', monospace",
                    fontSize: '13px',
                    lineHeight: '1.75',
                    overflow: 'auto',
                },
                '.cm-content': { padding: '14px 0', caretColor: colors.foreground },
                '.cm-line': { padding: '0 14px' },
                '.cm-gutters': {
                    backgroundColor: colors.gutter,
                    color: colors.gutterText,
                    borderRight: `1px solid ${colors.border}`,
                },
                '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: colors.activeLine },
                '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
                    {
                        backgroundColor: colors.selection,
                    },
                '.cm-cursor, .cm-dropCursor': { borderLeftColor: colors.foreground },
                '.cm-tooltip': {
                    backgroundColor: colors.gutter,
                    color: colors.foreground,
                    border: `1px solid ${colors.border}`,
                },
                '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
                    backgroundColor: colors.selection,
                    color: colors.foreground,
                },
                '.cm-panels': { backgroundColor: colors.gutter, color: colors.foreground },
                '.cm-searchMatch': { backgroundColor: colors.selection },
            },
            { dark: preset === 'midnight' },
        ),
        syntaxHighlighting(
            HighlightStyle.define([
                { tag: [tags.tagName, tags.angleBracket], color: colors.tag },
                { tag: [tags.attributeName, tags.propertyName], color: colors.attribute },
                { tag: [tags.string, tags.attributeValue], color: colors.string },
                { tag: [tags.keyword, tags.modifier, tags.operator], color: colors.keyword },
                { tag: [tags.number, tags.bool], color: colors.number },
                { tag: tags.comment, color: colors.comment, fontStyle: 'italic' },
            ]),
        ),
    ]
}
