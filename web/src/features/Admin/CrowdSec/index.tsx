import CrowdSecPageView from './Components/CrowdSecPageView'
import useCrowdSecLogic from './Hooks/useCrowdSecLogic'
import type { CrowdSecPageProps } from './Types/crowdsec.types'

export default function CrowdSecPage(props: CrowdSecPageProps) {
    return <CrowdSecPageView logic={useCrowdSecLogic(props)} />
}
