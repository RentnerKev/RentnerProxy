import { useSyncExternalStore } from 'react'

import { useToastStore } from './useToast'

export default function useToastViewportLogic() {
    const store = useToastStore()
    return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
}
