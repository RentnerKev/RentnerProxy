import type { z } from 'zod'

import type { Translate } from '../../../language/useTranslationStore'

interface ValidationIssue {
    readonly code?: string
    readonly message?: string
    readonly origin?: string
    readonly format?: string
    readonly minimum?: number | bigint
    readonly maximum?: number | bigint
    readonly path?: readonly PropertyKey[]
}

function localizeValidationIssue(t: Translate, issue: ValidationIssue): string {
    if (/^(?:validation|account|admin)\./u.test(issue.message ?? '')) return t(issue.message!)
    if (issue.code === 'too_small') {
        const min = Number(issue.minimum ?? 1)
        if (issue.origin === 'string') {
            return t(min === 1 ? 'validation.required' : 'validation.minLength', { count: min })
        }
        return t(issue.origin === 'array' ? 'validation.minItems' : 'validation.numberMin', {
            count: min,
        })
    }
    if (issue.code === 'too_big') {
        return t(
            issue.origin === 'string'
                ? 'validation.maxLength'
                : issue.origin === 'array'
                  ? 'validation.maxItems'
                  : 'validation.numberMax',
            { count: Number(issue.maximum) },
        )
    }
    if (issue.code === 'invalid_format') {
        return t(
            issue.format === 'email'
                ? 'validation.emailInvalid'
                : issue.path?.at(-1) === 'code'
                  ? 'validation.totpInvalid'
                  : 'validation.invalidValue',
        )
    }
    if (issue.code === 'invalid_type') return t('validation.required')
    if (issue.code === 'invalid_value') return t('validation.selectOption')
    if (issue.code === 'custom' && issue.path?.at(-1) === 'confirmPassword') {
        return t('validation.passwordMismatch')
    }
    return t('validation.invalidValue')
}

// Store structured errors so already-visible validation messages follow language changes.
export function getValidationIssue(schema: z.ZodType, value: unknown, field?: string) {
    const result = schema.safeParse(value)
    const issue = result.success ? undefined : result.error.issues[0]
    return issue && field && issue.path.length === 0 ? { ...issue, path: [field] } : issue
}

export default function getFieldErrorMessage(
    errors: readonly unknown[],
    t?: Translate,
): string | null {
    for (const error of errors) {
        if (typeof error === 'string') return t ? t(error, { defaultValue: error }) : error
        if (error && typeof error === 'object') {
            if (t) return localizeValidationIssue(t, error as ValidationIssue)
            if ('message' in error && typeof error.message === 'string') return error.message
        }
    }
    return null
}
