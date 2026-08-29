import { Link } from '@tanstack/react-router'
import { CircleUserRound, LogOut, UserRound } from 'lucide-react'

import { applicationShellClassNames } from '../Styles/applicationShellClassNames'
import type { ApplicationUserPanelProps } from '../Types/application-shell.types'

export default function ApplicationUserPanel({
    canViewAccount,
    isLoggingOut,
    onLogout,
    user,
}: ApplicationUserPanelProps) {
    const classNames = applicationShellClassNames.userPanel

    return (
        <div className={classNames.root}>
            <div className={classNames.identity}>
                <span className={classNames.identityIcon} aria-hidden="true">
                    <CircleUserRound />
                </span>
                <div className={classNames.identityText}>
                    <span className={classNames.displayName}>{user.displayName}</span>
                    <small className={classNames.email}>{user.email}</small>
                </div>
            </div>
            <div className={classNames.actions}>
                {canViewAccount ? (
                    <Link to="/account" className={classNames.accountAction}>
                        <UserRound aria-hidden="true" />
                        Account
                    </Link>
                ) : null}
                <button
                    type="button"
                    className={classNames.logoutAction}
                    onClick={onLogout}
                    disabled={isLoggingOut}
                    aria-busy={isLoggingOut}
                >
                    <LogOut aria-hidden="true" />
                    {isLoggingOut ? 'Signing out…' : 'Logout'}
                </button>
            </div>
        </div>
    )
}
