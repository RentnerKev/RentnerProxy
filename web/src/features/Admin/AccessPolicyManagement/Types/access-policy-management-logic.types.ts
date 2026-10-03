export type ActionResult = {
    readonly success: boolean
    readonly message: string
    readonly runtimeStatus?: 'applied' | 'pending'
}
