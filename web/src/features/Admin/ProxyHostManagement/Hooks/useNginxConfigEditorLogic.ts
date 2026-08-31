import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { tokenizeNginx } from '../Helpers/nginxConfigSource'

export type NginxColorPreset = 'system' | 'midnight' | 'paper'

export default function useNginxConfigEditorLogic(value: string) {
    const [preset, setPreset] = useState<NginxColorPreset>('system')
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const highlightRef = useRef<HTMLPreElement>(null)
    const gutterRef = useRef<HTMLPreElement>(null)
    const tokens = useMemo(() => tokenizeNginx(value), [value])
    const lineNumbers = useMemo(
        () =>
            value
                .split('\n')
                .map((_line, index) => index + 1)
                .join('\n'),
        [value],
    )
    const syncScroll = useCallback(() => {
        const input = inputRef.current
        if (!input) return
        if (highlightRef.current) {
            highlightRef.current.scrollTop = input.scrollTop
            highlightRef.current.scrollLeft = input.scrollLeft
        }
        if (gutterRef.current) gutterRef.current.scrollTop = input.scrollTop
    }, [])
    useLayoutEffect(syncScroll, [value, syncScroll])
    return { preset, setPreset, tokens, lineNumbers, inputRef, highlightRef, gutterRef, syncScroll }
}
