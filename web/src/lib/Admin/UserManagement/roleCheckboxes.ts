export function getRoleCheckboxInputId(fieldName: string, roleId: string): string {
    return `${fieldName}-${roleId}`
}

export function getNextSelectedRoleKeys(
    selectedRoleKeys: readonly string[],
    roleKey: string,
): Array<string> {
    return selectedRoleKeys.includes(roleKey)
        ? selectedRoleKeys.filter((key) => key !== roleKey)
        : [...selectedRoleKeys, roleKey]
}
