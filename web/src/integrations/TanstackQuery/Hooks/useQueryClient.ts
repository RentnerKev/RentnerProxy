import { useState } from 'react'

import createQueryClient from '../../../lib/TanstackQuery/createQueryClient.ts'

export default function useQueryClient() {
    const [queryClient] = useState(createQueryClient)

    return queryClient
}
