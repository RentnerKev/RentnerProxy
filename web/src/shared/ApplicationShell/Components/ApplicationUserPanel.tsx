import { Link } from '@tanstack/react-router'
import { LogOut, UserRound } from 'lucide-react'

import { UserAvatar } from '../../Avatar'
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
                <UserAvatar
                    displayName={user.displayName}
                    profileImageVersion={user.profileImageVersion}
                    size="sm"
                    userId={user.id}
                />
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
