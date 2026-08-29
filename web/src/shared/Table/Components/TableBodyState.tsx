import type { TableBodyStateProps } from '../Types/table.types'

export default function TableBodyState({ columnCount, state }: TableBodyStateProps) {
    return (
        <tr>
            <td colSpan={columnCount} className="px-5 py-14">
                <div className="mx-auto flex max-w-md flex-col items-center text-center">
                    <span
                        className="mb-4 size-2.5 rounded-full bg-brand-500 shadow-[0_0_0_6px_rgb(48_238_97_/_12%)]"
                        aria-hidden="true"
                    />
                    <h3 className="text-base font-extrabold text-ink-soft">{state.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted">{state.description}</p>
                    {state.action ? <div className="mt-4">{state.action}</div> : null}
                </div>
            </td>
        </tr>
    )
}
