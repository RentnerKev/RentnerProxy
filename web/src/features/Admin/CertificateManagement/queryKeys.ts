export const certificateManagementQueryKeys = {
    all: ['admin', 'certificates'] as const,
    details: (certificateId: string) =>
        ['admin', 'certificates', 'details', certificateId] as const,
    assignable: ['admin', 'certificates', 'assignable'] as const,
}
