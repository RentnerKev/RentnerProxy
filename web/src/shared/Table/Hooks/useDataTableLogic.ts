import type { DataTableLogicParams, DataTableLogicResult } from '../Types/table.types.ts'
import useDataTableIds from './useDataTableIds.ts'
import useTableFilters from './useTableFilters.ts'

export default function useDataTableLogic({
    showColumnFilters,
    onToggleColumnFilters,
}: DataTableLogicParams): DataTableLogicResult {
    const { searchId, titleId } = useDataTableIds()
    const filterPanel = useTableFilters(showColumnFilters, onToggleColumnFilters)

    return {
        state: {
            searchId,
            titleId,
            filterPanelId: filterPanel.contentId,
            filtersExpanded: filterPanel.open,
        },
        handler: { handleToggleFilters: filterPanel.toggle },
    }
}
