import { statusClassName } from '@/lib/Admin/ProxyAccessLogs/proxyAccessLogs.ts'

export default function ProxyLogStatusBadge({ status }: { readonly status: number }) {
    return (
        <span
            className={`inline-flex rounded-full border px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold ${statusClassName(status)}`}
        >
            {status}
        </span>
    )
}
