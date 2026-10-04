import { isCanonicalForwardAuthEndpoint } from '@/lib/ForwardAuth/forwardAuth.ts'
import { getAccessPolicyAvailability } from '@/lib/Admin/AccessPolicyManagement/basicAuthPolicyState.ts'
import { validateBasicAuthAccount } from '@/lib/Admin/AccessPolicyManagement/basicAuthValidation.ts'
import {
    parseAccessPolicyIpRulesDraft,
    splitIpRuleLines,
} from '@/lib/Admin/AccessPolicyManagement/ipAccessPolicyState.ts'
import type {
    AccessPolicyFormFieldsLogicInputs,
    AccessPolicyFormFieldsLogicResult,
} from '../Types/form-fields-logic.types.ts'

export default function useAccessPolicyFormFieldsLogic({
    values,
    basicAuthAccountCount,
}: AccessPolicyFormFieldsLogicInputs): AccessPolicyFormFieldsLogicResult {
    const ipRulesSectionVisible = values.mode === 'ip-restricted' || values.mode === 'combined'
    const authenticationModeVisible = values.mode === 'authenticated' || values.mode === 'combined'
    const basicAuthReady =
        authenticationModeVisible &&
        values.authMethod === 'basicAuth' &&
        basicAuthAccountCount === 0 &&
        Object.keys(validateBasicAuthAccount(values.basicAuth, 'create')).length === 0
    const parsedIpRules = values.ipRules
        ? parseAccessPolicyIpRulesDraft(values.ipRules)
        : { rules: null }
    const availabilityIpRules = values.ipRules
        ? 'error' in parsedIpRules
            ? {
                  defaultAction: values.ipRules.defaultAction,
                  allow: splitIpRuleLines(values.ipRules.allow),
                  deny: splitIpRuleLines(values.ipRules.deny),
              }
            : parsedIpRules.rules
        : null
    const availability = getAccessPolicyAvailability(
        values.mode,
        values.combination,
        basicAuthReady ? 1 : basicAuthAccountCount,
        availabilityIpRules,
    )
    const availabilityKey =
        authenticationModeVisible && values.authMethod === 'forwardAuth'
            ? isCanonicalForwardAuthEndpoint(values.forwardAuth.endpoint)
                ? 'forwardAuthConfigured'
                : 'forwardAuthMissing'
            : basicAuthReady && values.mode === 'authenticated'
              ? 'basicAuthReady'
              : availability
    const availabilityClassName =
        availabilityKey === 'publicIgnored'
            ? 'border-border bg-surface-subtle'
            : availabilityKey.includes('Missing') || availability.includes('BlocksAll')
              ? 'border-amber-500/35 bg-amber-500/10'
              : 'border-success-text/25 bg-success-bg'

    return {
        state: {
            ipRulesSectionVisible,
            authenticationModeVisible,
            availability,
            availabilityKey,
            availabilityClassName,
        },
    }
}
