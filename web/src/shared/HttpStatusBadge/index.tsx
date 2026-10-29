import type { HttpStatusBadgeProps } from './Types/http-status-badge.types.ts'

export default function HttpStatusBadge({ status }: HttpStatusBadgeProps) {
    return (
        <span
            className={`inline-flex w-fit rounded-full border px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold ${status >= 500 ? 'border-red-500/25 bg-danger-bg text-danger-text' : status >= 400 ? 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300' : status >= 300 ? 'border-blue-500/20 bg-info-bg text-info-text' : 'border-brand-600/20 bg-success-bg text-success-text'}`}
        >
            {status}
        </span>
    )
}
