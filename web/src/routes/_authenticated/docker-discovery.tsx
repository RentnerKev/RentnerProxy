import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import DockerDiscoveryPage from '@/features/Admin/DockerDiscovery/index.tsx'
import { discoveryApi } from '@/features/Admin/DockerDiscovery/discovery-api.ts'
import { requirePermissionRoute } from '@/features/Auth/route-guards.ts'
export const Route = createFileRoute('/_authenticated/docker-discovery')({
    beforeLoad: (context) => {
        requirePermissionRoute(PERMISSIONS.DOCKER_DISCOVERY_VIEW)(context)
        requirePermissionRoute(PERMISSIONS.PROXY_HOSTS_VIEW)(context)
    },
    component: DockerDiscoveryRoute,
})
function DockerDiscoveryRoute() {
    const { user } = Route.useRouteContext()
    return (
        <DockerDiscoveryPage
            key={`${user.id}:${user.permissions.join(',')}`}
            permissions={user.permissions}
            api={discoveryApi}
        />
    )
}
