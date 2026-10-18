import type { Props } from '../Types/redirect-runtime-status-panel.types.ts'
import RuntimeStatusPanel from '@/shared/RuntimeStatus/index.tsx'
export default function RedirectRuntimeStatusPanel(props: Props) {
    return (
        <RuntimeStatusPanel
            {...props}
            translationPrefix="admin.redirectHosts.runtime"
            showStatusDot={false}
        />
    )
}
