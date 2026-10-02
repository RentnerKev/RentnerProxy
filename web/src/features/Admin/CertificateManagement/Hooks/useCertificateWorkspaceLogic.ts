import { useState } from 'react'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import type {
    CertificateManagementPageProps,
    CertificateWorkspaceLogicResult,
} from '../Types/certificate-management.types.ts'

export default function useCertificateWorkspaceLogic({
    permissions,
}: CertificateManagementPageProps): CertificateWorkspaceLogicResult {
    const canViewServers = permissions.includes(PERMISSIONS.CERTIFICATES_VIEW)
    const canViewTrustedCas = permissions.includes(PERMISSIONS.TRUSTED_CAS_VIEW)
    const [selected, setSelected] = useState<'server' | 'trusted'>(
        canViewServers ? 'server' : 'trusted',
    )
    const active =
        selected === 'trusted' && canViewTrustedCas
            ? 'trusted'
            : canViewServers
              ? 'server'
              : 'trusted'
    const tabs = [
        {
            value: 'server' as const,
            allowed: canViewServers,
            label: 'admin.certificates.tabs.server',
        },
        {
            value: 'trusted' as const,
            allowed: canViewTrustedCas,
            label: 'admin.certificates.tabs.trusted',
        },
    ].filter((tab) => tab.allowed)
    return {
        state: { active, canViewServers, canViewTrustedCas, tabs },
        handler: { handleSelect: setSelected },
    }
}
