export interface TablePaginationControlsProps {
    readonly pageIndex: number
    readonly pageSize: number
    readonly total: number
    readonly pageSizeOptions: ReadonlyArray<number>
    readonly itemLabel: string
    readonly onPageChange: (pageIndex: number) => void
    readonly onPageSizeChange: (pageSize: number) => void
    readonly disabled?: boolean
}

export interface TablePaginationControlsLogicResult {
    readonly state: {
        readonly safePageSize: number
        readonly rowsPerPageLabel: string
        readonly rangeLabel: string
        readonly pageLabel: string
        readonly disabled: boolean
        readonly firstPage: boolean
        readonly lastPage: boolean
        readonly pageSizeOptions: readonly { readonly label: string; readonly value: string }[]
        readonly items: readonly (
            | { readonly kind: 'ellipsis'; readonly key: string }
            | {
                  readonly kind: 'page'
                  readonly key: number
                  readonly page: number
                  readonly current: boolean
                  readonly label: string
              }
        )[]
    }
    readonly handler: {
        readonly handleFirstPage: () => void
        readonly handlePreviousPage: () => void
        readonly handleNextPage: () => void
        readonly handleLastPage: () => void
        readonly handlePageChange: (page: number) => void
        readonly handlePageSizeChange: (value: string) => void
    }
}
