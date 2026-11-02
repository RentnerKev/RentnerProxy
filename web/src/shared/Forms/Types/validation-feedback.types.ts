/** Exposes per-field completion signals without coupling feedback to shared validation-array identity. */
export interface ValidationFeedbackResult {
    readonly state: { readonly validationEpochs: Readonly<Record<string, number>> }
    readonly handler: { readonly handleValidationCompleted: (names: readonly string[]) => void }
}
