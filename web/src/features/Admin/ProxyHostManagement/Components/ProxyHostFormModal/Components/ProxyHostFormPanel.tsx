import type { ProxyHostFormPanelProps } from '../Types/form-sections.types.ts'

export default function ProxyHostFormPanel({
    activeTab,
    tab,
    formId,
    children,
}: ProxyHostFormPanelProps) {
    return (
        <section
            role="tabpanel"
            id={`${formId}-panel-${tab}`}
            aria-labelledby={`${formId}-tab-${tab}`}
            hidden={activeTab !== tab}
            tabIndex={-1}
            className="min-w-0 outline-hidden shell:col-span-full"
        >
            <div className="grid gap-4 shell:grid-cols-2 shell:items-start">{children}</div>
        </section>
    )
}
