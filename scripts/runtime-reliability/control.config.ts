export const resourceLimits = { memoryBytes: 1024 ** 3, pids: 512, postgresConnections: 100 }

export const metrics = [
    'memoryBytes',
    'cpuPercent',
    'pids',
    'postgresConnections',
    'webFds',
    'controllerFds',
    'caddyFds',
    'restartCount',
] as const
