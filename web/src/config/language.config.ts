import type { AppLanguage } from '../language/useTranslationStore'

export const FALLBACK_LANGUAGE: AppLanguage = 'en'
export const AVAILABLE_LANGUAGES = ['en', 'de', 'es', 'fr'] as const

export const LANGUAGE_RESOURCE_LOADERS = {
    en: () => import('../language/Locales/en.json').then((module) => module.default),
    de: () => import('../language/Locales/de.json').then((module) => module.default),
    es: () => import('../language/Locales/es.json').then((module) => module.default),
    fr: () => import('../language/Locales/fr.json').then((module) => module.default),
} as const

export function isAppLanguage(value: unknown): value is AppLanguage {
    return typeof value === 'string' && AVAILABLE_LANGUAGES.some((language) => language === value)
}

export const LANGUAGE_LOCALES: Record<AppLanguage, string> = {
    en: 'en-GB',
    de: 'de-DE',
    es: 'es-ES',
    fr: 'fr-FR',
}

export const FLAG_IMAGES: Record<AppLanguage, string> = {
    en: '/images/flags/en.svg',
    de: '/images/flags/de.svg',
    es: '/images/flags/es.svg',
    fr: '/images/flags/fr.svg',
}

// Shared controls on public routes stay English without loading a locale catalog.
export const PUBLIC_ENGLISH: Record<string, string> = {
    'common.appName': 'RentnerProxy',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.working': 'Working…',
    'common.closeDialog': 'Close dialog',
    'common.showPassword': 'Show password',
    'common.hidePassword': 'Hide password',
    'common.openActions': 'Open actions',
    'common.profilePicture': "{{name}}'s profile picture",
    'common.retry': 'Try again',
    'common.backHome': 'Back to home',
    'shell.home': 'RentnerProxy home',
    'system.response': 'System response',
    'system.recovery': 'Safe route recovery',
    'system.error.eyebrow': 'Unexpected interruption',
    'system.error.title': 'Something went wrong.',
    'system.error.description':
        'An unexpected error interrupted this page. Try again, or return to the homepage to continue from a safe route.',
    'system.error.nextStep': 'What to do next',
    'system.error.command': 'Command for the administrator',
    'system.error.code': 'Error code',
    'system.error.reference': 'Error reference',
    'system.error.causes.databaseSchema.title': 'Database update required',
    'system.error.causes.databaseSchema.description':
        'The application and database schema do not match. A required table or field is missing.',
    'system.error.causes.databaseSchema.nextStep':
        'An administrator should apply pending database migrations from the project directory, then try again.',
    'system.error.causes.databaseBusy.title': 'Database connection limit reached',
    'system.error.causes.databaseBusy.description':
        'The database cannot accept another connection right now.',
    'system.error.causes.databaseBusy.nextStep':
        "Try again shortly. If this continues, an administrator should check the application's database connection pool.",
    'system.error.causes.databaseUnavailable.title': 'Database unavailable',
    'system.error.causes.databaseUnavailable.description':
        'RentnerProxy cannot connect to the configured database.',
    'system.error.causes.databaseUnavailable.nextStep':
        'An administrator should check that PostgreSQL is running and that the database connection settings are correct.',
    'system.error.causes.databaseAuthentication.title': 'Database access rejected',
    'system.error.causes.databaseAuthentication.description':
        "The database rejected the application's configured access credentials.",
    'system.error.causes.databaseAuthentication.nextStep':
        'An administrator should check the configured database account, password, and access permissions.',
    'system.error.causes.sessionExpired.title': 'Sign-in required',
    'system.error.causes.sessionExpired.description':
        'Your session is no longer valid, or this page requires a new sign-in.',
    'system.error.causes.sessionExpired.nextStep':
        'Return to the homepage, sign in again, and reopen this page.',
    'system.error.causes.accessDenied.title': 'Access denied',
    'system.error.causes.accessDenied.description':
        'Your account does not have permission to access this page or its data.',
    'system.error.causes.accessDenied.nextStep':
        "Return to the homepage. If you need access, ask an administrator to check your account's permissions.",
    'system.error.causes.notFound.title': 'Requested data not found',
    'system.error.causes.notFound.description':
        'The requested data no longer exists or is no longer available.',
    'system.error.causes.notFound.nextStep':
        'Return to the homepage and reopen the item from the current list.',
    'system.error.causes.rateLimited.title': 'Too many requests',
    'system.error.causes.rateLimited.description':
        'The request limit has been reached temporarily.',
    'system.error.causes.rateLimited.nextStep':
        'Wait a moment before trying again. Avoid repeatedly refreshing the page.',
    'system.error.causes.serviceUnavailable.title': 'A required service is unavailable',
    'system.error.causes.serviceUnavailable.description':
        'A service needed to load this page is temporarily unavailable.',
    'system.error.causes.serviceUnavailable.nextStep':
        'Try again shortly. If this continues, send the error code and reference to an administrator to check the server logs.',
    'system.error.causes.network.title': 'Connection interrupted',
    'system.error.causes.network.description':
        'The connection to the application could not be completed.',
    'system.error.causes.network.nextStep':
        'Check your network connection and try again. If other pages work, an administrator should check the application server.',
    'system.error.causes.assetLoad.title': 'Application files could not be loaded',
    'system.error.causes.assetLoad.description':
        'A required application or language file could not be downloaded.',
    'system.error.causes.assetLoad.nextStep':
        'Try again to reload the page. If this continues, check your connection and ask an administrator to check the deployment.',
    'system.error.causes.unexpected.title': 'The page could not be loaded',
    'system.error.causes.unexpected.description':
        'An unexpected error occurred. The application could not determine a more specific cause.',
    'system.error.causes.unexpected.nextStep':
        'Try again. If this continues, send the error code and any reference to an administrator to check the browser and server logs.',
    'system.notFound.eyebrow': 'Route unavailable',
    'system.notFound.title': 'Page not found.',
    'system.notFound.description':
        'The page you are looking for does not exist or may have moved. The RentnerProxy foundation is still running.',
}
