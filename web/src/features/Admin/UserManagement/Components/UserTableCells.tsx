import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { formatUserCreatedAt, getVisibleRoleKeys } from '../Helpers/userTableCells'
import type {
    UserCreatedAtCellProps,
    UserEmailCellProps,
    UserNameCellProps,
    UserRolesCellProps,
    UserStatusCellProps,
} from '../Types/user-management-table-cell.types'

const statusBadgeClassName =
    'inline-flex rounded-full bg-neutral px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold text-muted capitalize data-[status=active]:bg-success-bg data-[status=active]:text-success-text data-[status=disabled]:bg-danger-bg data-[status=disabled]:text-danger-text'

export function UserNameCell({ value }: UserNameCellProps) {
    return <span className="font-extrabold text-ink-soft">{value}</span>
}

export function UserEmailCell({ value }: UserEmailCellProps) {
    return <span className="text-muted">{value}</span>
}

export function UserStatusCell({ value }: UserStatusCellProps) {
    return (
        <span className={statusBadgeClassName} data-status={value}>
            {value}
        </span>
    )
}

export function UserRolesCell({ roleKeys }: UserRolesCellProps) {
    const visibleRoleKeys = getVisibleRoleKeys(roleKeys)

    return (
        <div className={uiClassNames.chip.row}>
            {visibleRoleKeys.map((roleKey) => (
                <span className={uiClassNames.chip.item} key={roleKey}>
                    {roleKey}
                </span>
            ))}
            {roleKeys.length > visibleRoleKeys.length ? (
                <span className="text-xs font-bold text-muted">
                    +{roleKeys.length - visibleRoleKeys.length}
                </span>
            ) : null}
        </div>
    )
}

export function UserCreatedAtCell({ value }: UserCreatedAtCellProps) {
    return (
        <span className="whitespace-nowrap text-muted">
            {formatUserCreatedAt(value, dateFormatter)}
        </span>
    )
}

const dateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })
