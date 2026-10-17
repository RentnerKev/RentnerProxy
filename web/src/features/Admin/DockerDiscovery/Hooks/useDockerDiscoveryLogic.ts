import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts/toast'
import {
    DOCKER_DISCOVERY_QUERY_KEY,
    DOCKER_DISCOVERY_LIVE_QUERY_KEYS,
    DOCKER_DISCOVERY_RECONCILE_PERMISSIONS,
    DOCKER_DISCOVERY_COMPOSE_EXAMPLE,
    DOCKER_DISCOVERY_NATIVE_EXAMPLE,
} from '@/config/docker-discovery.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type {
    DiscoveryOverview,
    DiscoveryRow,
} from '@/lib/DockerDiscovery/Types/management.types.ts'
import { invalidateProxyHostManagementCache } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useLiveInvalidation from '@/shared/Live/Hooks/useLiveInvalidation.ts'
import useQueryRecovery from '@/shared/Live/Hooks/useQueryRecovery.ts'
import useQueryErrorToast from '@/shared/Notifications/Hooks/useQueryErrorToast.ts'
import type {
    DockerDiscoveryPageProps,
    DiscoveryConfirmation,
    DiscoveryConnectionContext,
    DiscoveryConnectionProps,
    DockerDiscoveryLogicResult,
} from '../Types/discovery-ui.types.ts'

export default function useDockerDiscoveryLogic({
    permissions,
    api,
    liveEnabled = true,
}: DockerDiscoveryPageProps): DockerDiscoveryLogicResult {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const canView =
        permissions.includes(PERMISSIONS.DOCKER_DISCOVERY_VIEW) &&
        permissions.includes(PERMISSIONS.PROXY_HOSTS_VIEW)
    const canManage = canView && permissions.includes(PERMISSIONS.DOCKER_DISCOVERY_MANAGE)
    const canActivate = DOCKER_DISCOVERY_RECONCILE_PERMISSIONS.every((permission) =>
        permissions.includes(permission),
    )
    const canDetach = canManage && permissions.includes(PERMISSIONS.PROXY_HOSTS_UPDATE)
    const [connection, setConnection] = useState<DiscoveryConnectionContext | null>(null)
    const [confirmation, setConfirmation] = useState<DiscoveryConfirmation | null>(null)
    const [selection, setSelection] = useState<DiscoveryRow | null>(null)
    const [guide, setGuide] = useState(false)
    const [busy, setBusy] = useState(false)
    const pending = useRef(false)
    const query = useQuery({
        queryKey: DOCKER_DISCOVERY_QUERY_KEY,
        queryFn: api.status,
        enabled: canView,
        retry: false,
    })
    useQueryRecovery(query, canView)
    useLiveInvalidation({
        topic: 'docker-discovery',
        query: {},
        enabled: canView && liveEnabled,
        queryKeys: DOCKER_DISCOVERY_LIVE_QUERY_KEYS,
    })
    useQueryErrorToast(
        canView && (query.isError || query.data?.snapshot === null),
        'admin.dockerDiscovery.errors.controller_unavailable',
    )
    const overview = canView ? query.data : undefined
    const snapshot = overview?.snapshot
    useQueryErrorToast(
        canView && snapshot?.status === 'unavailable',
        'admin.dockerDiscovery.errors.endpoint_unavailable',
    )
    useQueryErrorToast(
        canView && Boolean(overview?.management.error),
        `admin.dockerDiscovery.issues.${overview?.management.error ?? 'reconcile_failed'}`,
    )
    const available = Boolean(snapshot && !query.isError)
    const needsActivation =
        !overview?.management.enabled ||
        snapshot?.configuration.revision !== overview.management.connectorRevision ||
        snapshot?.status === 'paused' ||
        overview.management.error === 'authorization_required'
    const locked = busy || !available
    const details =
        overview?.rows.find(
            (row) => row.key === selection?.key && row.containerId === selection.containerId,
        ) ??
        overview?.rows.find((row) => row.key === selection?.key) ??
        (selection ? { ...selection, state: 'unavailable' as const } : null)
    useEffect(() => {
        if (!canView) {
            void queryClient.cancelQueries({ queryKey: DOCKER_DISCOVERY_QUERY_KEY })
            queryClient.removeQueries({ queryKey: DOCKER_DISCOVERY_QUERY_KEY })
        }
    }, [canView, queryClient])
    async function run(operation: () => Promise<unknown>, message: string): Promise<boolean> {
        if (pending.current || !canManage) return false
        pending.current = true
        setBusy(true)
        try {
            await operation()
            toast.success(t(message), { title: t('toast.titles.success') })
            return true
        } catch (error) {
            const key = error instanceof Error ? error.message : ''
            toast.error(
                t(
                    /^(admin\.dockerDiscovery\.errors\.[a-zA-Z_]+|errors\.[a-zA-Z_]+)$/u.test(key)
                        ? key
                        : 'admin.dockerDiscovery.errors.requestFailed',
                ),
                { title: t('toast.titles.error') },
            )
            return false
        } finally {
            await Promise.allSettled([
                queryClient.invalidateQueries({ queryKey: DOCKER_DISCOVERY_QUERY_KEY }),
                invalidateProxyHostManagementCache(queryClient),
            ])
            pending.current = false
            setBusy(false)
        }
    }
    const latest = () => queryClient.getQueryData<DiscoveryOverview>(DOCKER_DISCOVERY_QUERY_KEY)
    const changed = () => {
        setConfirmation(null)
        toast.info(t('admin.dockerDiscovery.messages.changed'), { title: t('toast.titles.info') })
    }
    const saveConnection: DiscoveryConnectionProps['onSave'] = async (input) => {
        const current = latest()
        if (
            !current?.snapshot ||
            current.snapshot.configuration.revision !== input.connectorRevision
        ) {
            changed()
            return false
        }
        const saved = await run(
            () => api.connect({ ...input, expectedRevision: current.management.revision }),
            'admin.dockerDiscovery.messages.connected',
        )
        if (saved) setConnection(null)
        return saved
    }
    return {
        state: {
            canView,
            canManage,
            canActivate,
            canDetach,
            overview,
            available,
            locked,
            busy,
            loading: query.isPending,
            connectorStatus: query.isPending
                ? 'connecting'
                : !available
                  ? 'unavailable'
                  : (snapshot?.status ?? 'disabled'),
            needsActivation,
            canEnable: canActivate && snapshot?.status === 'ready' && !snapshot.stale,
            canRetry: Boolean(
                canManage &&
                (!overview?.management.enabled || canActivate) &&
                snapshot?.configuration.settings.enabled &&
                overview?.management.error !== 'authorization_required',
            ),
            connection,
            confirmation,
            guide,
            details,
            candidate:
                snapshot?.candidates.find(
                    (candidate) => candidate.containerId === details?.containerId,
                ) ?? null,
            showRetry: Boolean(
                snapshot?.status === 'unavailable' ||
                Boolean(overview?.management.error) ||
                overview?.rows.some((row) => row.state === 'conflicted'),
            ),
        },
        handler: {
            openConnection: () => {
                if (!locked && canManage && snapshot)
                    setConnection({
                        connected: snapshot.configuration.settings.enabled,
                        endpoint: snapshot.configuration.settings.endpoint ?? '',
                        connectorRevision: snapshot.configuration.revision,
                        restorePaused: snapshot.status === 'paused',
                    })
            },
            closeConnection: () => {
                if (!pending.current) setConnection(null)
            },
            saveConnection,
            disconnect: async () => {
                const current = latest()
                if (!current || locked) return false
                const saved = await run(
                    () =>
                        api.change({
                            expectedRevision: current.management.revision,
                            action: 'disconnect',
                        }),
                    'admin.dockerDiscovery.messages.disconnected',
                )
                if (saved) setConnection(null)
                return saved
            },
            openGuide: () => setGuide(true),
            closeGuide: () => setGuide(false),
            copyExample: (native: boolean) => {
                void Promise.resolve()
                    .then(() =>
                        navigator.clipboard.writeText(
                            native
                                ? DOCKER_DISCOVERY_NATIVE_EXAMPLE
                                : DOCKER_DISCOVERY_COMPOSE_EXAMPLE,
                        ),
                    )
                    .then(() =>
                        toast.success(t('admin.dockerDiscovery.messages.copied'), {
                            title: t('toast.titles.success'),
                        }),
                    )
                    .catch(() =>
                        toast.error(t('admin.dockerDiscovery.errors.copyFailed'), {
                            title: t('toast.titles.error'),
                        }),
                    )
            },
            showDetails: (row: DiscoveryRow) => setSelection(row),
            closeDetails: () => setSelection(null),
            askEnable: () => {
                if (!locked && canActivate && overview)
                    setConfirmation({
                        kind: 'enable',
                        revision: overview.management.revision,
                        previewToken: overview.previewToken,
                        ...overview.changes,
                    })
            },
            askDetach: (row: DiscoveryRow) => {
                if (!locked && canDetach && overview && row.hostId && row.state !== 'detached')
                    setConfirmation({
                        kind: 'detach',
                        revision: overview.management.revision,
                        key: row.key,
                        name: row.domains[0] ?? row.sourceId,
                    })
            },
            closeConfirmation: (open: boolean) => {
                if (!open && !pending.current) setConfirmation(null)
            },
            confirm: async () => {
                const current = latest()
                if (!confirmation || locked || !current) return
                if (
                    current.management.revision !== confirmation.revision ||
                    (confirmation.kind === 'enable' &&
                        current.previewToken !== confirmation.previewToken)
                ) {
                    changed()
                    return
                }
                await run(
                    () =>
                        api.change(
                            confirmation.kind === 'enable'
                                ? {
                                      expectedRevision: confirmation.revision,
                                      action: 'enable',
                                      previewToken: confirmation.previewToken,
                                  }
                                : {
                                      expectedRevision: confirmation.revision,
                                      action: 'detach',
                                      key: confirmation.key,
                                  },
                        ),
                    `admin.dockerDiscovery.messages.${confirmation.kind === 'enable' ? 'enabled' : 'detached'}`,
                )
                setConfirmation(null)
            },
            disable: () => {
                const current = latest()
                if (!locked && current)
                    void run(
                        () =>
                            api.change({
                                expectedRevision: current.management.revision,
                                action: 'disable',
                            }),
                        'admin.dockerDiscovery.messages.disabled',
                    )
            },
            retry: () => {
                const current = latest()
                if (!locked && current)
                    void run(
                        () =>
                            api.change({
                                expectedRevision: current.management.revision,
                                action: 'retry',
                            }),
                        'admin.dockerDiscovery.messages.retrying',
                    )
            },
        },
    }
}
