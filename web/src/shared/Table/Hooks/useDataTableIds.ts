import { useId } from 'react'

export default function useDataTableIds() {
    return {
        searchId: useId(),
        titleId: useId(),
    }
}
