import { useRef } from 'react'

export default function useApplicationSidebarRefs() {
    const sidebarRef = useRef<HTMLElement>(null)
    const sidebarScrollRef = useRef<HTMLDivElement>(null)

    return { sidebarRef, sidebarScrollRef }
}
