export type HtmlEditorColorPreset = 'rentnerproxy' | 'midnight' | 'paper'

export interface HtmlEditorColors {
    readonly background: string
    readonly foreground: string
    readonly gutter: string
    readonly gutterText: string
    readonly border: string
    readonly activeLine: string
    readonly selection: string
    readonly tag: string
    readonly attribute: string
    readonly string: string
    readonly keyword: string
    readonly number: string
    readonly comment: string
}
