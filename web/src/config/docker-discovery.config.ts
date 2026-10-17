export const DOCKER_DISCOVERY_MUTATION_RATE_LIMIT = {
    scope: 'docker-discovery-mutation',
    limit: 10,
    windowMs: 60_000,
} as const
