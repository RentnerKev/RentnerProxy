/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The combobox uses a custom listbox with categorized, two-line options. */
import { SearchInput } from '@rentnerkev/inputs/search-input'
import { Search } from 'lucide-react'
import { Modal } from '@/shared/Modal/index.tsx'
import { QUICK_SEARCH_MAX_QUERY_LENGTH } from '@/config/quick-search.config.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useQuickSearchLogic from './Hooks/useQuickSearchLogic.ts'
import type { QuickSearchProps } from './Types/quick-search.types.ts'

export default function QuickSearch(props: QuickSearchProps) {
    const { t } = useTranslationStore()
    const {
        state,
        handler,
        refs: { input: inputRef },
    } = useQuickSearchLogic(props)
    return (
        <>
            <button
                type="button"
                aria-label={t('quickSearch.open')}
                aria-haspopup="dialog"
                aria-expanded={state.open}
                aria-keyshortcuts="Control+k Meta+k"
                onClick={handler.open}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-border-strong bg-surface-raised px-3 text-sm font-bold text-muted hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring"
            >
                <Search aria-hidden="true" className="size-4" />
                <span className="hidden sm:inline">{t('quickSearch.open')}</span>
                <kbd
                    aria-hidden="true"
                    className="hidden rounded border border-border px-1.5 py-0.5 font-mono text-xs sm:inline"
                >
                    {state.shortcut}
                </kbd>
            </button>
            <Modal
                open={state.open}
                onOpenChange={handler.setOpen}
                onOpenAutoFocus={handler.focusInput}
                title={t('quickSearch.title')}
                description={t('quickSearch.description')}
                footer={
                    <p className="m-0 w-full text-xs text-muted">{t('quickSearch.keyboardHint')}</p>
                }
            >
                <label htmlFor={state.inputId} className="block">
                    <span className="sr-only">{t('quickSearch.queryLabel')}</span>
                    <SearchInput
                        ref={inputRef}
                        id={state.inputId}
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={state.open}
                        aria-controls={state.listId}
                        aria-activedescendant={state.activeOptionId}
                        aria-describedby={state.hintId}
                        value={state.query}
                        onValueChange={handler.changeQuery}
                        maxLength={QUICK_SEARCH_MAX_QUERY_LENGTH}
                        placeholder={t('quickSearch.placeholder')}
                        autoComplete="off"
                        icon={<Search aria-hidden="true" />}
                    />
                </label>
                <p id={state.hintId} className="my-3 text-xs leading-relaxed text-muted">
                    {state.needsQuery
                        ? t('quickSearch.minQuery')
                        : t('quickSearch.limited', { count: state.limit })}
                </p>
                <div role="status" aria-live="polite" className="text-sm text-muted">
                    {state.isLoading ? <p>{t('quickSearch.loading')}</p> : null}
                    {state.isOpening ? <p>{t('quickSearch.opening')}</p> : null}
                    {state.targetUnavailable ? <p>{t('quickSearch.targetUnavailable')}</p> : null}
                    {!state.isLoading && !state.hasResults && !state.hasErrors ? (
                        <p>{t('quickSearch.noResults')}</p>
                    ) : null}
                </div>
                {state.hasErrors ? (
                    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-warning-text/30 bg-warning-bg p-3 text-sm text-warning-text">
                        <p role="status" className="m-0">
                            {t('quickSearch.unavailable')}
                        </p>
                        <button
                            type="button"
                            onClick={handler.retry}
                            className="min-h-11 cursor-pointer rounded-lg px-3 font-bold underline focus-visible:outline-2 focus-visible:outline-accent-ring"
                        >
                            {t('quickSearch.retry')}
                        </button>
                    </div>
                ) : null}
                <div
                    id={state.listId}
                    role="listbox"
                    aria-label={t('quickSearch.resultsLabel')}
                    aria-busy={state.isLoading || state.isOpening}
                    className="max-h-[min(50dvh,24rem)] overflow-y-auto overscroll-contain"
                >
                    {state.groups.map((group) => (
                        <div
                            key={group.category}
                            role="group"
                            aria-labelledby={`${state.listId}-${group.category}`}
                            className="mb-3 last:mb-0"
                        >
                            <p
                                id={`${state.listId}-${group.category}`}
                                className="my-2 px-3 text-xs font-bold tracking-wide text-muted"
                            >
                                {group.label}
                            </p>
                            {group.results.map((result) => (
                                <button
                                    key={result.id}
                                    id={result.optionId}
                                    type="button"
                                    role="option"
                                    aria-selected={state.activeOptionId === result.optionId}
                                    tabIndex={-1}
                                    disabled={state.isOpening}
                                    onPointerEnter={() => handler.highlight(result.id)}
                                    onClick={() => handler.select(result)}
                                    className="mb-1 block min-h-12 w-full cursor-pointer rounded-xl border border-transparent px-3 py-2 text-left hover:bg-surface-hover aria-selected:border-accent-ring/50 aria-selected:bg-accent-muted focus-visible:outline-2 focus-visible:outline-accent-ring disabled:cursor-wait"
                                >
                                    <span className="block break-words text-sm font-bold text-ink">
                                        {result.label}
                                    </span>
                                    {result.detail ? (
                                        <span className="mt-0.5 block break-all text-xs text-muted">
                                            {result.detail}
                                        </span>
                                    ) : null}
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            </Modal>
        </>
    )
}
