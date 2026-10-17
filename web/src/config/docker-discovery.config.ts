import { PERMISSIONS } from './permissions.config.ts'

export const DOCKER_DISCOVERY_QUERY_KEY = ['docker-discovery', 'overview'] as const
export const DOCKER_DISCOVERY_LIVE_QUERY_KEYS = [DOCKER_DISCOVERY_QUERY_KEY] as const
export const DOCKER_DISCOVERY_RECONCILE_PERMISSIONS = [
    PERMISSIONS.DOCKER_DISCOVERY_VIEW,
    PERMISSIONS.DOCKER_DISCOVERY_MANAGE,
    PERMISSIONS.PROXY_HOSTS_VIEW,
    PERMISSIONS.PROXY_HOSTS_CREATE,
    PERMISSIONS.PROXY_HOSTS_UPDATE,
    PERMISSIONS.PROXY_HOSTS_APPLY,
] as const

export const DOCKER_DISCOVERY_MUTATION_RATE_LIMIT = {
    scope: 'docker-discovery-mutation',
    limit: 10,
    windowMs: 60_000,
} as const

export const DOCKER_DISCOVERY_COMPOSE_EXAMPLE = `services:
  rentnerproxy:
    networks: [default, proxy, discovery-control]
  docker-api:
    image: mirror.gcr.io/library/haproxy:3.2.26@sha256:06843e9d60fcdae4e43ff8e001859249a5352f1b8e522058ce86e6f8cf789507
    user: "0:0"
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./docker/discovery/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
    networks: [discovery-control]
  example-app:
    image: mirror.gcr.io/oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598
    user: "1000:1000"
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    command: [bun, --no-env-file, -e, "Bun.serve({hostname: '0.0.0.0', port: 8080, fetch: () => new Response('Docker Discovery works')})"]
    labels:
      rentnerproxy.enable: "true"
      rentnerproxy.id: example-app
      rentnerproxy.domains: app.example.com
      rentnerproxy.port: "8080"
      rentnerproxy.network: rentnerproxy-proxy
    networks: [proxy]
networks:
  default: {}
  proxy:
    name: rentnerproxy-proxy
  discovery-control:
    internal: true`

export const DOCKER_DISCOVERY_NATIVE_EXAMPLE = `services:
  docker-api:
    image: mirror.gcr.io/library/haproxy:3.2.26@sha256:06843e9d60fcdae4e43ff8e001859249a5352f1b8e522058ce86e6f8cf789507
    user: "0:0"
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    ports: ["127.0.0.1:2375:2375"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./docker/discovery/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
    networks: [discovery-control]
  example-app:
    image: mirror.gcr.io/oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598
    user: "1000:1000"
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    command: [bun, --no-env-file, -e, "Bun.serve({hostname: '0.0.0.0', port: 8080, fetch: () => new Response('Docker Discovery works')})"]
    labels:
      rentnerproxy.enable: "true"
      rentnerproxy.id: example-app
      rentnerproxy.domains: app.example.com
      rentnerproxy.port: "8080"
      rentnerproxy.network: rentnerproxy-proxy
    networks: [proxy]
networks:
  proxy:
    name: rentnerproxy-proxy
  discovery-control:
    internal: true`
