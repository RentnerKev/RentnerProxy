interface FormMessageProps {
    readonly children: string
    readonly tone: 'error' | 'success' | 'info'
}

const toneClassNames = {
    error: 'border-[rgb(166_27_27_/_22%)] bg-danger-bg text-danger-text',
    success: 'border-[rgb(13_138_49_/_22%)] bg-success-bg text-success-text',
    info: 'border-[rgb(34_85_117_/_20%)] bg-info-bg text-info-text',
} as const

export default function FormMessage({ children, tone }: FormMessageProps) {
    return (
        <p
            className={`mt-4 rounded-xl border p-[0.8rem] px-[0.9rem] text-[0.84rem] leading-[1.5] ${toneClassNames[tone]}`}
            role={tone === 'error' ? 'alert' : 'status'}
        >
            {children}
        </p>
    )
}
