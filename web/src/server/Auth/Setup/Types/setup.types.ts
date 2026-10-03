export type FirstOwnerSetupResult =
    | { readonly success: true; readonly userId: string; readonly email: string }
    | { readonly success: false; readonly code: 'already_initialized' }
