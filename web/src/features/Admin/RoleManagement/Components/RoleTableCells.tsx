import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { formatRoleCreatedAt } from '../Helpers/roleTableCells'
import type {
    RoleCreatedAtCellProps,
    RoleDescriptionCellProps,
    RoleNameCellProps,
    RoleNumberCellProps,
    RoleTypeCellProps,
} from '../Types/role-management-table-cell.types'

const roleBadgeClassName =
    'inline-flex rounded-full px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold data-[type=custom]:bg-success-bg data-[type=custom]:text-success-text data-[type=system]:bg-neutral data-[type=system]:text-muted'

export function RoleNameCell({ name, roleKey }: RoleNameCellProps) {
    return (
        <div className="grid gap-1">
            <span className="font-extrabold text-ink-soft">{name}</span>
            <code className={`${uiClassNames.table.code} w-fit`}>{roleKey}</code>
        </div>
    )
}

export function RoleDescriptionCell({ value }: RoleDescriptionCellProps) {
    return <span className="block max-w-72 text-sm leading-relaxed text-muted">{value || '—'}</span>
}

export function RoleTypeCell({ value }: RoleTypeCellProps) {
    return (
        <span className={roleBadgeClassName} data-type={value}>
            {value}
        </span>
    )
}

export function RolePermissionCountCell({ value }: RoleNumberCellProps) {
    return <span className="whitespace-nowrap text-muted">{value} assigned</span>
}

export function RoleUserCountCell({ value }: RoleNumberCellProps) {
    return <span className="text-muted">{value}</span>
}

export function RoleCreatedAtCell({ value }: RoleCreatedAtCellProps) {
    return (
        <span className="whitespace-nowrap text-muted">
            {formatRoleCreatedAt(value, dateFormatter)}
        </span>
    )
}

const dateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })
