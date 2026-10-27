import { useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '@tanstack/react-form'
import { toast } from '@rentnerkev/toasts'
import { inspectCertificateDnsSetupHandler } from '../../../middleware.ts'
import type {
    DnsSetupInput,
    DnsSetupResult,
} from '@/lib/Admin/CertificateManagement/Types/dns-setup.types.ts'
import type { CertificateProviderFieldsProps } from '../Types/certificate-request-modal.types.ts'
import type { DnsConnectionChoice } from '@/lib/DnsConnections/Types/dns-connections.types.ts'
import {
    isPublicAcmeDomain,
    normalizeCertificateDomain,
} from '@/lib/Admin/CertificateManagement/certificateValidation.ts'
import { dnsSetupInputSchema } from '@/lib/Admin/CertificateManagement/dnsSetupValidation.ts'
import { dnsZoneNameSchema } from '@/lib/DnsConnections/validation.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export default function useDnsSetupInspection(
    form: CertificateProviderFieldsProps['form'],
    connection: DnsConnectionChoice | undefined,
    disabled: boolean,
) {
    const { t } = useTranslationStore()
    const values = useStore(form.store, (state) => state.values)
    const [delegationType, setDelegationType] = useState<'cname' | 'ns'>('cname')
    const [targetDraft, setTargetDraft] = useState({ zoneId: '', value: '' })
    const [checked, setChecked] = useState<{ key: string; result: DnsSetupResult } | null>(null)
    const [pendingKey, setPendingKey] = useState('')
    const pending = useRef(new Set<string>())
    const zone = connection?.zones.find((item) => item.id === values.dnsZoneId)
    const mode = values.dnsMode === 'delegated' ? 'delegated' : 'provider'
    const targetOwner =
        targetDraft.zoneId === values.dnsZoneId
            ? targetDraft.value
            : zone
              ? `acme.${zone.name}`
              : ''
    const domains = values.domains.map((value) => value.trim()).filter(Boolean)
    const input: DnsSetupInput | null =
        connection && zone
            ? {
                  domains,
                  environment: values.environment === 'staging' ? 'staging' : 'production',
                  dnsMode: mode,
                  connectionId: connection.id,
                  expectedRevision: connection.revision,
                  zoneId: zone.id,
                  ...(mode === 'delegated'
                      ? {
                            delegation:
                                delegationType === 'cname'
                                    ? { type: 'cname' as const, targetOwner }
                                    : { type: 'ns' as const },
                        }
                      : {}),
              }
            : null
    const signature = JSON.stringify({
        input,
        domains,
        mode,
        delegationType,
        targetOwner,
        disabled,
    })
    const [generation, setGeneration] = useState({ signature, value: 0 })
    const version = generation.signature === signature ? generation.value : generation.value + 1
    if (generation.signature !== signature) setGeneration({ signature, value: version })
    const key = `${version}:${signature}`
    const latestKey = useRef(key)
    useLayoutEffect(() => {
        latestKey.current = key
        return () => {
            latestKey.current = ''
        }
    }, [key])
    const result = checked?.key === key ? checked.result : null
    const normalizedDomains = domains.map(normalizeCertificateDomain)
    const owners = normalizedDomains.every(
        (domain) => domain !== null && isPublicAcmeDomain(domain, true),
    )
        ? [
              ...new Set(
                  normalizedDomains.map(
                      (domain) => `_acme-challenge.${domain!.replace(/^\*\./u, '')}`,
                  ),
              ),
          ]
        : []
    const normalizedTarget = targetOwner.trim().toLowerCase().replace(/\.$/u, '')
    const targetValid =
        mode !== 'delegated' ||
        delegationType !== 'cname' ||
        Boolean(
            zone &&
            dnsZoneNameSchema.safeParse(normalizedTarget).success &&
            (normalizedTarget === zone.name || normalizedTarget.endsWith(`.${zone.name}`)) &&
            !owners.includes(normalizedTarget),
        )
    const draftValid = Boolean(
        input && dnsSetupInputSchema.safeParse(input).success && owners.length && targetValid,
    )
    const canCheck = !disabled && draftValid
    const preview = owners.map((owner) => ({
        owner,
        type: mode === 'provider' ? 'TXT' : delegationType === 'cname' ? 'CNAME' : 'NS',
        values:
            draftValid && mode === 'delegated' && delegationType === 'cname'
                ? [normalizedTarget + '.']
                : [],
    }))
    const records = result
        ? result.results.map((item) => ({
              type: item.instruction.type,
              owner: item.instruction.owner,
              values: item.instruction.values,
              status: item.status,
          }))
        : preview.map((item) => ({
              type: item.type,
              owner: item.owner,
              values: item.values,
              status: null,
          }))
    return {
        state: {
            delegationType,
            targetOwner,
            targetInvalid:
                mode === 'delegated' && delegationType === 'cname' && Boolean(zone) && !targetValid,
            result,
            records,
            checking: pendingKey === key,
            canCheck,
        },
        handler: {
            changeDelegationType: (value: string) => {
                if (value === 'cname' || value === 'ns') setDelegationType(value)
            },
            changeTargetOwner: (value: string) =>
                setTargetDraft({ zoneId: values.dnsZoneId, value }),
            check: async () => {
                if (!input || !canCheck || pending.current.has(key)) return
                pending.current.add(key)
                setPendingKey(key)
                setChecked(null)
                try {
                    const response = await inspectCertificateDnsSetupHandler({
                        data: { ...input, domains: [...input.domains] },
                    })
                    if (latestKey.current !== key) return
                    if (!response.success) {
                        toast.error(t(response.message), { title: t('toast.titles.error') })
                        return
                    }
                    if (
                        response.setup.connectionId !== input.connectionId ||
                        response.setup.connectionRevision !== input.expectedRevision ||
                        response.setup.zoneId !== input.zoneId ||
                        response.setup.dnsMode !== input.dnsMode
                    )
                        throw new Error('stale')
                    setChecked({ key, result: response.setup })
                } catch {
                    if (latestKey.current === key)
                        toast.error(t('admin.certificates.errors.actionFailed'), {
                            title: t('toast.titles.error'),
                        })
                } finally {
                    pending.current.delete(key)
                    setPendingKey((current) => (current === key ? '' : current))
                }
            },
            copy: async (value: string) => {
                try {
                    await navigator.clipboard.writeText(value)
                    toast.success(t('admin.certificates.manualDns.copied'), {
                        title: t('toast.titles.success'),
                    })
                } catch {
                    toast.error(t('admin.certificates.manualDns.copyFailed'), {
                        title: t('toast.titles.error'),
                    })
                }
            },
        },
    }
}
