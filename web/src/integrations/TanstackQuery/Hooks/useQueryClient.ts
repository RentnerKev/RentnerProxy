import { useState } from 'react'

import createQueryClient from '../Helpers/createQueryClient.ts'

export default function useQueryClient() {
    const [queryClient] = useState(createQueryClient)

    return queryClient
}
