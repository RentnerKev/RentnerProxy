import { useDateFormatter } from '../../../../language/useTranslationStore'
import useTranslationStore from '../../../../language/useTranslationStore'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { formatAccessPolicyCreatedAt } from '../Helpers/accessPolicyTableCells'
import { getAccessPolicyAvailability, getIpAccessRuleCount } from '../Helpers/basicAuthPolicyState'
import type {
    AccessPolicyBasicAuthCellProps,
    AccessPolicyAssignedCountCellProps,
    AccessPolicyCombinationCellProps,
    AccessPolicyCreatedAtCellProps,
    AccessPolicyIpRulesCellProps,
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
        <span className={modeBadgeClassName} data-mode={mode}>
            {t(`admin.accessPolicies.mode.${mode}`)}
        </span>
    )
}

export function AccessPolicyBasicAuthCell({
    combination,
    count,
    ipRules,
    mode,
}: AccessPolicyBasicAuthCellProps) {
    const { t } = useTranslationStore()
    const status = getAccessPolicyAvailability(mode, combination, count, ipRules)
    const statusClassName =
        status === 'publicIgnored'
            ? 'text-muted'
            : status.includes('Missing') || status.includes('BlocksAll')
              ? 'text-amber-700'
              : 'text-success-text'

    return (
        <div className="grid justify-items-start gap-1">
            <span className="font-extrabold text-ink-soft">
                {t('admin.accessPolicies.basicAuth.cells.accountCount', { count })}
            </span>
            <span className={`text-[0.68rem] font-bold ${statusClassName}`}>
                {t(`admin.accessPolicies.availability.${status}`)}
            </span>
        </div>
    )
}

export function AccessPolicyIpRulesCell({
    basicAuthAccountCount,
    combination,
    ipRules,
    mode,
}: AccessPolicyIpRulesCellProps) {
    const { t } = useTranslationStore()
    const status = getAccessPolicyAvailability(mode, combination, basicAuthAccountCount, ipRules)
    const statusClassName =
        status === 'publicIgnored'
            ? 'text-muted'
            : status.includes('Missing') || status.includes('BlocksAll')
              ? 'text-amber-700'
              : 'text-success-text'
    const summary = ipRules
        ? t('admin.accessPolicies.ipRules.cells.summary', {
              action: t(`admin.accessPolicies.ipRules.defaultAction.${ipRules.defaultAction}`),
              count: getIpAccessRuleCount(ipRules),
              allow: ipRules.allow.length,
              deny: ipRules.deny.length,
          })
        : t('admin.accessPolicies.ipRules.cells.notConfigured')

    return (
        <div className="grid justify-items-start gap-1">
            <span className="font-extrabold text-ink-soft">{summary}</span>
            <span className={`text-[0.68rem] font-bold ${statusClassName}`}>
                {t(`admin.accessPolicies.availability.${status}`)}
            </span>
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
