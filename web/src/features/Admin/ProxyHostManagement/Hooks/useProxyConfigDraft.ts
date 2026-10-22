import { useState } from 'react'

import type { ProxyHttpSettings } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

import type { ProxyConfigEditorSubmission } from '../Types/proxy-config-editor.types.ts'

/** Keeps an editing basis separate from refreshed server data until explicitly accepted. */
export default function useProxyConfigDraft<T extends ProxyConfigEditorSubmission>(
    data: T | undefined,
) {
    const [draft, setDraft] = useState<
        (ProxyConfigEditorSubmission & { baseline: ProxyHttpSettings }) | null
    >(null)
    const [hasConflict, setHasConflict] = useState(false)
    const [reviewedLatest, setReviewedLatest] = useState<T | null>(null)
    const [isConflictConfirmationOpen, setConflictConfirmationOpen] = useState(false)
    const settings = draft?.settings ?? data?.settings ?? {}
    const baseRevision = draft?.baseRevision ?? data?.baseRevision ?? null
    const updateSetting = <K extends keyof ProxyHttpSettings>(
        key: K,
        value: ProxyHttpSettings[K],
    ) => {
        if (!data || baseRevision === null || hasConflict) return
        const next = { ...settings }
        if (value === undefined) delete next[key]
        else next[key] = value
        setDraft({ settings: next, baseline: draft?.baseline ?? data.settings, baseRevision })
    }
    const markConflict = (submitted: ProxyConfigEditorSubmission) => {
        if (!draft) setDraft({ ...submitted, baseline: submitted.settings })
        setHasConflict(true)
        setReviewedLatest(null)
        setConflictConfirmationOpen(false)
    }
    const clearDraft = () => {
        setDraft(null)
        setHasConflict(false)
        setReviewedLatest(null)
        setConflictConfirmationOpen(false)
    }
    const acceptDraft = () => {
        if (!reviewedLatest || !draft) return
        const merged = { ...reviewedLatest.settings }
        const keys = new Set([
            ...Object.keys(draft.baseline),
            ...Object.keys(draft.settings),
        ] as (keyof ProxyHttpSettings)[])
        for (const key of keys) {
            if (draft.settings[key] === draft.baseline[key]) continue
            if (draft.settings[key] === undefined) delete merged[key]
            else Object.assign(merged, { [key]: draft.settings[key] })
        }
        setDraft({
            settings: merged,
            baseline: reviewedLatest.settings,
            baseRevision: reviewedLatest.baseRevision,
        })
        setHasConflict(false)
        setReviewedLatest(null)
        setConflictConfirmationOpen(false)
    }
    const keepDraft = () => {
        if (!reviewedLatest || !draft) return
        const keys = new Set([
            ...Object.keys(draft.baseline),
            ...Object.keys(draft.settings),
        ] as (keyof ProxyHttpSettings)[])
        const overlaps = [...keys].some(
            (key) =>
                draft.settings[key] !== draft.baseline[key] &&
                reviewedLatest.settings[key] !== draft.baseline[key] &&
                reviewedLatest.settings[key] !== draft.settings[key],
        )
        if (overlaps) setConflictConfirmationOpen(true)
        else acceptDraft()
    }
    const useSaved = () => {
        if (!reviewedLatest) return
        setDraft({ ...reviewedLatest, baseline: reviewedLatest.settings })
        setConflictConfirmationOpen(false)
        setHasConflict(false)
        setReviewedLatest(null)
    }
    return {
        settings,
        baseRevision,
        hasConflict,
        reviewedLatest,
        isConflictConfirmationOpen,
        updateSetting,
        markConflict,
        clearDraft,
        setReviewedLatest,
        setConflictConfirmationOpen,
        acceptDraft,
        keepDraft,
        useSaved,
    }
}
