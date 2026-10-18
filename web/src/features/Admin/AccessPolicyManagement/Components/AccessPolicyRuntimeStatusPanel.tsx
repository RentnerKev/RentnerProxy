import type { AccessPolicyRuntimeStatusPanelProps } from '../Types/access-policy-runtime-status-panel.types.ts'
import RuntimeStatusPanel from '@/shared/RuntimeStatus/index.tsx'
export default function AccessPolicyRuntimeStatusPanel(props: AccessPolicyRuntimeStatusPanelProps) {
    return <RuntimeStatusPanel {...props} translationPrefix="admin.accessPolicies.runtime" />
}
