import { useEffect, useState } from 'react'

import { createToastStore } from '../Helpers/createToastStore'

export default function useToastProviderLogic() {
    const [store] = useState(createToastStore)
    useEffect(() => () => store.notify.clear(), [store])
    return store
}
