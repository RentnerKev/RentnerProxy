import usePageAlert from './Hooks/usePageAlert.ts'
import type { PageAlertProps } from './Types/page-alerts.types.ts'

export default function PageAlert(props: PageAlertProps) {
    usePageAlert(props)
    return null
}
