import { useState } from 'react'

import createQueryClient from '../Helpers/createQueryClient'

export default function useQueryClient() {
    const [queryClient] = useState(createQueryClient)

    return queryClient
}
