export type UpdateSystemAccentColorResult =
    | { readonly success: true; readonly accentColor: string }
    | { readonly success: false; readonly message: string }
