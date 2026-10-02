export interface ApplicationVersionLogicResult {
    readonly state: { readonly data: { readonly latestVersion: string | null } | undefined }
}
