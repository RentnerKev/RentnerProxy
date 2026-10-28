import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DOMAIN_DIAGNOSTICS_STAGE_NAMES } from '@/config/domain-diagnostics.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { proxyHostManagementQueryKeys } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import { redirectHostManagementQueryKeys } from '@/lib/Admin/RedirectHostManagement/redirectHostManagementCache.ts'
import {
    DomainCheckError,
    requestDomainCheck,
    serializeDomainCheckSummary,
} from '@/lib/RuntimeDiagnostics/domainCheck.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type {
    DomainCheckAttempt,
    DomainCheckDialogLogic,
    DomainCheckDialogProps,
} from '../Types/domain-check-dialog.types.ts'

export default function useDomainCheckDialogLogic({
    open,
    onOpenChange,
    hostType,
    host,
    permissions,
}: DomainCheckDialogProps): DomainCheckDialogLogic {
    const { t, locale, language } = useTranslationStore()
    const queryClient = useQueryClient()
    const canCheck = permissions.includes(
        hostType === 'proxy' ? PERMISSIONS.PROXY_HOSTS_VIEW : PERMISSIONS.REDIRECT_HOSTS_VIEW,
    )
    const scope = JSON.stringify([
        hostType,
        host.id,
        host.updatedAt.toISOString(),
        host.enabled,
        host.domains,
        open,
        canCheck,
    ])
    const [selection, setSelection] = useState({ scope, domain: host.domains[0] ?? '' })
    const domain =
        selection.scope === scope && host.domains.includes(selection.domain)
            ? selection.domain
            : (host.domains[0] ?? '')
    const key = JSON.stringify([scope, domain])
    const [view, setView] = useState<{
        scope: string
        hasRun: boolean
        notice: 'changed' | 'cancelled' | null
    }>({
        scope,
        hasRun: false,
        notice: null,
    })
    if (view.scope !== scope) {
        setView({ scope, hasRun: false, notice: view.hasRun ? 'changed' : null })
    }
    const [sequence, setSequence] = useState(0)
    const sequenceRef = useRef(0)
    const active = useRef<{ key: string; controller: AbortController } | null>(null)
    const observing = useRef(false)
    const [copyFeedback, setCopyFeedback] = useState<{
        key: string
        sequence: number
        code: 'copied' | 'copyFailed'
    } | null>(null)
    const mutation = useMutation({
        retry: false,
        mutationFn: async (attempt: DomainCheckAttempt) => ({
            key: attempt.key,
            sequence: attempt.sequence,
            result: await requestDomainCheck(attempt.input, attempt.signal),
        }),
        onSettled: (_data, _error, attempt) => {
            if (active.current?.controller.signal === attempt.signal) active.current = null
        },
    })
    const { reset, mutate } = mutation
    const current = mutation.variables?.key === key && mutation.variables.sequence === sequence
    const isPending = current && mutation.isPending
    const result =
        canCheck && open && mutation.data?.key === key && mutation.data.sequence === sequence
            ? mutation.data.result
            : null
    const error =
        canCheck && current && mutation.error
            ? t(
                  `admin.domainCheck.errors.${mutation.error instanceof DomainCheckError ? mutation.error.code : 'request_failed'}`,
              )
            : null

    const stop = useCallback(
        (notice: 'changed' | 'cancelled' | null) => {
            active.current?.controller.abort()
            active.current = null
            observing.current = false
            setSequence(++sequenceRef.current)
            reset()
            setCopyFeedback(null)
            setView({ scope, hasRun: false, notice })
        },
        [reset, scope],
    )

    useEffect(
        () => () => {
            if (active.current && active.current.key !== key) return
            active.current?.controller.abort()
            active.current = null
            observing.current = false
            reset()
        },
        [key, reset],
    )

    useEffect(() => {
        if (!open || !canCheck) return
        return queryClient.getQueryCache().subscribe((event) => {
            if (!observing.current) return
            const relevant = [
                proxyHostManagementQueryKeys.all,
                redirectHostManagementQueryKeys.all,
            ].some((prefix) => prefix.every((part, index) => event.query.queryKey[index] === part))
            if (
                relevant &&
                (event.type === 'removed' ||
                    (event.type === 'updated' && event.action.type === 'invalidate'))
            )
                stop('changed')
        })
    }, [queryClient, open, canCheck, stop])

    function handleCheck() {
        if (!open || !canCheck || !domain || active.current) return
        const controller = new AbortController()
        active.current = { key, controller }
        observing.current = true
        const next = ++sequenceRef.current
        setSequence(next)
        setView({ scope, hasRun: true, notice: null })
        setCopyFeedback(null)
        mutate({
            input: { hostType, hostId: host.id, domain },
            key,
            sequence: next,
            signal: controller.signal,
        })
    }

    async function copySummary() {
        if (!result || !canCheck || isPending) return
        const attemptSequence = sequenceRef.current
        try {
            await navigator.clipboard.writeText(serializeDomainCheckSummary(result))
            if (attemptSequence === sequenceRef.current)
                setCopyFeedback({ key, sequence, code: 'copied' })
        } catch {
            if (attemptSequence === sequenceRef.current)
                setCopyFeedback({ key, sequence, code: 'copyFailed' })
        }
    }

    return {
        state: {
            canCheck,
            domain,
            domainOptions: host.domains.map((value) => ({ value, label: value })),
            selectLocale:
                language === 'de' || language === 'es' || language === 'fr' ? language : 'en',
            isPending,
            result,
            checkedAt: result
                ? new Intl.DateTimeFormat(locale, {
                      dateStyle: 'medium',
                      timeStyle: 'medium',
                  }).format(new Date(result.checkedAt))
                : null,
            stages: DOMAIN_DIAGNOSTICS_STAGE_NAMES.map((name) => {
                const stage = result?.stages[name]
                return {
                    name,
                    title: t(`admin.domainCheck.stages.${name}`),
                    status: stage?.status ?? 'pending',
                    statusLabel: t(
                        `admin.domainCheck.statuses.${stage?.status ?? (isPending ? 'pending' : 'not_checked')}`,
                    ),
                    description: stage
                        ? t(`admin.domainCheck.codes.${stage.code}.description`)
                        : t(isPending ? 'admin.domainCheck.pending' : 'admin.domainCheck.awaiting'),
                    advice:
                        stage && stage.status !== 'passed'
                            ? t(`admin.domainCheck.codes.${stage.code}.advice`)
                            : '',
                    addresses: stage?.addresses ?? [],
                    detail: stage
                        ? [
                              t('admin.domainCheck.duration', { duration: stage.durationMs }),
                              ...(stage.httpStatus === null
                                  ? []
                                  : [
                                        t('admin.domainCheck.httpStatus', {
                                            status: stage.httpStatus,
                                        }),
                                    ]),
                          ].join(' · ')
                        : null,
                }
            }),
            error,
            notice:
                view.scope === scope && view.notice ? t(`admin.domainCheck.${view.notice}`) : null,
            copyFeedback:
                copyFeedback?.key === key && copyFeedback.sequence === sequence
                    ? t(`admin.domainCheck.${copyFeedback.code}`)
                    : null,
        },
        handler: {
            handleCheck,
            handleCancel: () => stop('cancelled'),
            handleDomainChange: (value) => {
                if (!host.domains.includes(value)) return
                stop(null)
                setSelection({ scope, domain: value })
            },
            handleOpenChange: (value) => {
                if (!value) stop(null)
                onOpenChange(value)
            },
            handleCopy: () => {
                void copySummary()
            },
        },
    }
}
