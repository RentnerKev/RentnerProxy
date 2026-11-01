import type { AuthenticatedUser } from './Types/auth.types.ts'

export default function principalVersion(user: AuthenticatedUser): string {
    return JSON.stringify([user.id, user.roles.toSorted(), user.permissions.toSorted()])
}
