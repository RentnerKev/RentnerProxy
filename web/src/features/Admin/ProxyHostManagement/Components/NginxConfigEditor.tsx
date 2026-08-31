import useTranslationStore from '../../../../language/useTranslationStore'
import useNginxConfigEditorLogic from '../Hooks/useNginxConfigEditorLogic'
import type { NginxTokenKind } from '../Helpers/nginxConfigSource'
import type { NginxColorPreset } from '../Hooks/useNginxConfigEditorLogic'

const presets = {
    system: {
        frame: 'bg-code text-ink-soft',
        caret: 'caret-ink',
        gutter: 'bg-code text-muted-soft',
        comment: 'text-slate-500 dark:text-slate-400',
        directive: 'text-sky-700 dark:text-sky-300',
        string: 'text-emerald-700 dark:text-emerald-300',
        variable: 'text-fuchsia-700 dark:text-fuchsia-300',
        number: 'text-amber-800 dark:text-amber-300',
        punctuation: 'text-muted',
        plain: '',
    },
    midnight: {
        frame: 'bg-[#101827] text-slate-200',
        caret: 'caret-white',
        gutter: 'bg-[#101827] text-slate-500',
        comment: 'text-slate-400',
        directive: 'text-sky-300',
        string: 'text-emerald-300',
        variable: 'text-fuchsia-300',
        number: 'text-amber-300',
        punctuation: 'text-slate-400',
        plain: '',
    },
    paper: {
        frame: 'bg-slate-50 text-slate-900',
        caret: 'caret-slate-900',
        gutter: 'bg-slate-50 text-slate-400',
        comment: 'text-slate-500',
        directive: 'text-blue-700',
        string: 'text-emerald-700',
        variable: 'text-purple-700',
        number: 'text-orange-800',
        punctuation: 'text-slate-600',
        plain: '',
    },
} satisfies Record<NginxColorPreset, Record<NginxTokenKind | 'frame' | 'caret' | 'gutter', string>>

const codeClasses =
    'm-0 size-full whitespace-pre p-4 pl-14 font-mono text-[0.78rem] leading-6 [tab-size:4]'

interface NginxConfigEditorProps {
    readonly value: string
    readonly onChange: (value: string) => void
    readonly readOnly?: boolean
    readonly label: string
    readonly descriptionId: string
    readonly fileName: string
    readonly id?: string
    readonly heightClassName?: string
}

export default function NginxConfigEditor({
    value,
    onChange,
    readOnly = false,
    label,
    descriptionId,
    fileName,
    id = 'proxy-settings-source',
    heightClassName = 'h-[min(52vh,30rem)] min-h-64',
}: NginxConfigEditorProps) {
    const { t } = useTranslationStore()
    const {
        preset,
        setPreset,
        tokens,
        lineNumbers,
        inputRef,
        highlightRef,
        gutterRef,
        syncScroll,
    } = useNginxConfigEditorLogic(value)
    const colors = presets[preset]
    return (
        <div className="overflow-hidden rounded-xl border border-border" data-editor-theme={preset}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-raised px-3 py-2">
                <span className="min-w-0 break-all font-mono text-[0.68rem] text-muted">
                    {fileName}
                </span>
                <fieldset className="m-0 flex gap-1 border-0 p-0">
                    <legend className="sr-only">{t('admin.proxyHosts.config.colorPreset')}</legend>
                    {(['system', 'midnight', 'paper'] as const).map((option) => (
                        <button
                            key={option}
                            type="button"
                            aria-pressed={preset === option}
                            className={
                                'rounded-md px-2 py-1 text-[0.68rem] font-bold outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand-500 ' +
                                (preset === option
                                    ? 'bg-success-bg text-success-text'
                                    : 'text-muted hover:bg-surface-hover')
                            }
                            onClick={() => setPreset(option)}
                        >
                            {t('admin.proxyHosts.config.colors.' + option)}
                        </button>
                    ))}
                </fieldset>
            </div>
            <div className={'relative ' + heightClassName + ' overflow-hidden ' + colors.frame}>
                <pre
                    ref={highlightRef}
                    aria-hidden="true"
                    className={
                        'pointer-events-none absolute inset-0 overflow-hidden forced-colors:hidden ' +
                        codeClasses
                    }
                >
                    {tokens.map((token) => (
                        <span
                            key={token.offset}
                            data-nginx-token={token.kind}
                            className={colors[token.kind]}
                        >
                            {token.text}
                        </span>
                    ))}
                    {'\n'}
                </pre>
                <textarea
                    ref={inputRef}
                    id={id}
                    aria-label={label}
                    aria-describedby={descriptionId}
                    className={
                        'relative block resize-none overflow-auto bg-transparent text-transparent outline-hidden selection:bg-sky-400/25 focus-visible:shadow-[inset_0_0_0_2px_var(--color-brand-500)] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText] ' +
                        colors.caret +
                        ' ' +
                        codeClasses
                    }
                    value={value}
                    onChange={(event) => {
                        if (!readOnly) onChange(event.currentTarget.value)
                    }}
                    onScroll={syncScroll}
                    readOnly={readOnly}
                    wrap="off"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoComplete="off"
                    maxLength={65_536}
                />
                <pre
                    ref={gutterRef}
                    aria-hidden="true"
                    className={
                        'pointer-events-none absolute inset-y-0 left-0 m-0 w-11 overflow-hidden border-r border-current/10 py-4 pr-2 text-right font-mono text-[0.68rem] leading-6 select-none forced-colors:hidden ' +
                        colors.gutter
                    }
                >
                    {lineNumbers}
                    {'\n'}
                </pre>
            </div>
        </div>
    )
}
