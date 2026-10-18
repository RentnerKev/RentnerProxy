import type { ProxyRuntimeStatusPanelProps } from '../Types/proxy-runtime-status-panel.types.ts'
import RuntimeStatusPanel from '@/shared/RuntimeStatus/index.tsx'
export default function ProxyRuntimeStatusPanel(props: ProxyRuntimeStatusPanelProps) {
    return <RuntimeStatusPanel {...props} translationPrefix="admin.proxyHosts.runtime" />
}
