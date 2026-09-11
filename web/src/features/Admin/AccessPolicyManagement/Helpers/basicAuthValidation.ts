import {
    BASIC_AUTH_PASSWORD_MAX_LENGTH,
    BASIC_AUTH_USERNAME_MAX_LENGTH,
} from '../../../../config/access-policies.config'
import type {
    BasicAuthAccountFormErrors,
    BasicAuthAccountFormValues,
} from '../Types/basic-auth.types'

const BASIC_AUTH_USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/

export function validateBasicAuthAccount(
    values: BasicAuthAccountFormValues,
    mode: 'create' | 'edit',
): BasicAuthAccountFormErrors {
    const errors: { username?: string; password?: string } = {}

    if (values.username.length === 0) {
        errors.username = 'admin.accessPolicies.basicAuth.validation.usernameRequired'
    } else if (values.username.length > BASIC_AUTH_USERNAME_MAX_LENGTH) {
        errors.username = 'admin.accessPolicies.basicAuth.validation.usernameTooLong'
    } else if (!BASIC_AUTH_USERNAME_PATTERN.test(values.username)) {
        errors.username = 'admin.accessPolicies.basicAuth.validation.usernameInvalid'
    }

    if (mode === 'create' && values.password.length === 0) {
        errors.password = 'admin.accessPolicies.basicAuth.validation.passwordRequired'
    } else if (values.password.length > BASIC_AUTH_PASSWORD_MAX_LENGTH) {
        errors.password = 'admin.accessPolicies.basicAuth.validation.passwordTooLong'
    }

    return errors
}
