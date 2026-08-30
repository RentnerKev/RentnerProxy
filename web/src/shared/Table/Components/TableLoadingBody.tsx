import type { TableLoadingBodyProps } from '../Types/table.types'
import useTranslationStore from '../../../language/useTranslationStore'

export default function TableLoadingBody({ columnCount, loadingLabel }: TableLoadingBodyProps) {
    const { t } = useTranslationStore()

    return (
        <tbody aria-busy="true" aria-label={loadingLabel}>
            {Array.from({ length: 10 }, (_, rowIndex) => (
                <tr key={`loading-row-${rowIndex}`} className="border-b border-border">
                    {Array.from({ length: columnCount }, (__, columnIndex) => (
                        <td
                            key={`loading-cell-${rowIndex}-${columnIndex}`}
                            aria-label={t('table.loadingColumn', {
                                label: loadingLabel,
                                column: columnIndex + 1,
                            })}
                            className="h-[3.65rem] px-4 py-3"
                        >
                            <span
                                aria-hidden="true"
                                className="block h-3.5 w-full max-w-36 animate-pulse rounded-full bg-neutral motion-reduce:animate-none"
                            />
                        </td>
                    ))}
                </tr>
            ))}
        </tbody>
    )
}
