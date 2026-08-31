import CertificateManagementPageView from './Components/CertificateManagementPageView'
import useCertificateManagementLogic from './Hooks/useCertificateManagementLogic'
import type { CertificateManagementPageProps } from './Types/certificate-management.types'

export default function CertificateManagementPage(props: CertificateManagementPageProps) {
    return <CertificateManagementPageView logic={useCertificateManagementLogic(props)} />
}
