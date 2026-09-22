import { toast } from '@rentnerkev/toasts/toast'
import { useEffect } from 'react'

export default function useClearNotificationsOnLayoutExit(): void {
    useEffect(() => () => toast.dismissAll(), [])
}
