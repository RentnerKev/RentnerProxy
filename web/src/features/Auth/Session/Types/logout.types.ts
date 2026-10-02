export interface LogoutResult {
    state: { isLoggingOut: boolean }
    handler: { handleLogout: () => void }
}
