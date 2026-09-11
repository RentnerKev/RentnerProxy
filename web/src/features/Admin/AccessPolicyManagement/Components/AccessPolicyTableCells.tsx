import { useDateFormatter } from '../../../../language/useTranslationStore'
import useTranslationStore from '../../../../language/useTranslationStore'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { formatAccessPolicyCreatedAt } from '../Helpers/accessPolicyTableCells'
import type {
    AccessPolicyAssignedCountCellProps,
    AccessPolicyCombinationCellProps,
    AccessPolicyCreatedAtCellProps,
    AccessPolicyModeCellProps,
    AccessPolicyNameCellProps,
} from '../Types/access-policy-table.types'

const modeBadgeClassName =
    'inline-flex rounded-full px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold data-[mode=public]:bg-neutral data-[mode=public]:text-muted data-[mode=authenticated]:bg-amber-500/15 data-[mode=authenticated]:text-amber-700 data-[mode=ip-restricted]:bg-amber-500/15 data-[mode=ip-restricted]:text-amber-700 data-[mode=combined]:bg-amber-500/15 data-[mode=combined]:text-amber-700'

export function AccessPolicyNameCell({ name }: AccessPolicyNameCellProps) {
    return <span className="font-extrabold text-ink-soft">{name}</span>
}

export function AccessPolicyModeCell({ mode }: AccessPolicyModeCellProps) {
    const { t } = useTranslationStore()
    return (
        <div className="grid justify-items-start gap-1">
            <span className={modeBadgeClassName} data-mode={mode}>
                {t(`admin.accessPolicies.mode.${mode}`)}
            </span>
            {mode !== 'public' ? (
                <span className="text-[0.68rem] font-bold text-amber-700">
                    {t('admin.accessPolicies.mode.unconfigured')}
                </span>
            ) : null}
        </div>
    )
}

export function AccessPolicyCombinationCell({ combination }: AccessPolicyCombinationCellProps) {
    const { t } = useTranslationStore()
    return combination ? (
        <span className={uiClassNames.chip.item}>
            {t(`admin.accessPolicies.combination.${combination}`)}
        </span>
    ) : (
        <span className="text-muted">—</span>
    )
}

export function AccessPolicyAssignedCountCell({ value }: AccessPolicyAssignedCountCellProps) {
    const { t } = useTranslationStore()
    return (
        <span className="text-muted">
            {t('admin.accessPolicies.cells.assignedHosts', { count: value })}
        </span>
    )
}

export function AccessPolicyCreatedAtCell({ value }: AccessPolicyCreatedAtCellProps) {
    const formatter = useDateFormatter()
    return (
        <span className="whitespace-nowrap text-muted">
            {formatAccessPolicyCreatedAt(value, formatter)}
        </span>
    )
}
