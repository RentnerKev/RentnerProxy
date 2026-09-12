import { afterEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import withTestLanguage from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: RemoteTablePagination } =
    await import('../shared/Table/Components/RemoteTablePagination')
const { default: TablePaginationControls, getPaginationItems } =
    await import('../shared/Table/Components/TablePaginationControls')

let root: Root | undefined

function Harness({
    total,
    initialPageIndex = 0,
    initialPageSize = 15,
    remote = false,
    disabled = false,
}: {
    readonly total: number
    readonly initialPageIndex?: number
    readonly initialPageSize?: number
    readonly remote?: boolean
    readonly disabled?: boolean
}) {
    const [pageIndex, setPageIndex] = useState(initialPageIndex)
    const [pageSize, setPageSize] = useState(initialPageSize)
    const sharedProps = {
        pageIndex,
        pageSize,
        total,
        itemLabel: 'records',
        onPageChange: setPageIndex,
        onPageSizeChange: setPageSize,
        disabled,
    }
    return remote ? (
        <RemoteTablePagination {...sharedProps} />
    ) : (
        <TablePaginationControls {...sharedProps} pageSizeOptions={[15, 25, 50, 100]} />
    )
}

async function render(element: React.ReactElement): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(withTestLanguage(element)))
    return container
}

async function click(element: Element): Promise<void> {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await Promise.resolve()
    })
}

async function keydown(element: Element, key: string): Promise<void> {
    await act(async () => {
        element.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        )
        await Promise.resolve()
    })
}

async function choosePageSize(value: string): Promise<void> {
    const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]')
    expect(trigger).not.toBeNull()
    await act(async () => {
        trigger!.dispatchEvent(
            new PointerEvent('pointerdown', {
                bubbles: true,
                button: 0,
                cancelable: true,
                pointerType: 'mouse',
            }),
        )
        await Promise.resolve()
    })
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (candidate) => candidate.textContent?.trim() === value,
    )
    expect(option).not.toBeUndefined()
    await act(async () => {
        option!.dispatchEvent(
            new PointerEvent('pointerup', {
                bubbles: true,
                button: 0,
                cancelable: true,
                pointerType: 'mouse',
            }),
        )
        option!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await Promise.resolve()
    })
}

afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
})

describe('shared table pagination', () => {
    test('keeps numbered pages bounded with ellipses at every page-count boundary', () => {
        expect(getPaginationItems(0, 0)).toEqual([1])
        expect(getPaginationItems(0, 1)).toEqual([1])
        expect(getPaginationItems(0, 15)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 15])
        expect(getPaginationItems(0, 16)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 16])
        expect(getPaginationItems(14, 30)).toEqual([1, 'ellipsis', 14, 15, 16, 'ellipsis', 30])
        expect(getPaginationItems(15, 31)).toEqual([1, 'ellipsis', 15, 16, 17, 'ellipsis', 31])
    })

    test('renders empty and boundary totals without invalid ranges', async () => {
        const checkTotals = async (totals: readonly number[], index = 0): Promise<void> => {
            const total = totals[index]
            if (total === undefined) return
            await render(<Harness total={total} />)
            expect(document.body.textContent).toContain(`of ${total} records`)
            expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('1')
            await act(async () => root?.unmount())
            root = undefined
            document.body.replaceChildren()
            return checkTotals(totals, index + 1)
        }
        await checkTotals([0, 1, 15, 16, 30, 31])
    })

    test('supports first, last, numbered-page and keyboard-native button semantics', async () => {
        await render(<Harness total={600} initialPageIndex={7} />)
        const current = document.querySelector<HTMLButtonElement>('[aria-current="page"]')
        expect(current?.textContent).toBe('8')
        expect(current?.type).toBe('button')
        let receivedKeydown = false
        current?.addEventListener('keydown', () => {
            receivedKeydown = true
        })
        await keydown(current!, 'Enter')
        expect(receivedKeydown).toBeTrue()

        const pageNine = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
            (button) => button.getAttribute('aria-label') === 'Go to page 9',
        )
        expect(pageNine).not.toBeUndefined()
        await click(pageNine!)
        expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('9')

        await click(document.querySelector<HTMLButtonElement>('[aria-label="Go to last page"]')!)
        expect(document.body.textContent).toContain('Page 40 of 40')
        expect(
            document.querySelector<HTMLButtonElement>('[aria-label="Go to next page"]')?.disabled,
        ).toBeTrue()

        await click(document.querySelector<HTMLButtonElement>('[aria-label="Go to first page"]')!)
        expect(document.body.textContent).toContain('Page 1 of 40')
        expect(
            document.querySelector<HTMLButtonElement>('[aria-label="Go to previous page"]')
                ?.disabled,
        ).toBeTrue()
        expect(
            [...document.querySelectorAll('button')].every((button) => button.type === 'button'),
        ).toBeTrue()
    })

    test('resets to the first page when selecting every remote page size', async () => {
        await render(<Harness total={400} initialPageIndex={4} remote />)
        expect(document.body.textContent).toContain('Page 5 of 27')
        const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]')
        expect(trigger?.textContent).toContain('15')
        await choosePageSize('25')
        expect(document.body.textContent).toContain('Page 1 of 16')
        expect(trigger?.textContent).toContain('25')

        const checkPageSizes = async (values: readonly string[], index = 0): Promise<void> => {
            const value = values[index]
            if (value === undefined) return
            await choosePageSize(value)
            expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('1')
            return checkPageSizes(values, index + 1)
        }
        await checkPageSizes(['15', '25', '50', '100'])
    })

    test('disables every native control while remote data is loading', async () => {
        await render(<Harness total={31} remote disabled />)
        expect(
            [...document.querySelectorAll<HTMLButtonElement>('button')].every(
                (button) => button.disabled,
            ),
        ).toBeTrue()
        expect(document.querySelector<HTMLButtonElement>('[role="combobox"]')?.disabled).toBeTrue()
    })
})
