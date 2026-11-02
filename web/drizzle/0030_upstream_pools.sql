ALTER TABLE "rentnerproxy"."proxy_hosts" ADD COLUMN "upstream_pool" jsonb;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."proxy_hosts" ADD CONSTRAINT "proxy_hosts_upstream_pool_check" CHECK ("rentnerproxy"."proxy_hosts"."upstream_pool" is null or coalesce((
                jsonb_typeof("rentnerproxy"."proxy_hosts"."upstream_pool") = 'object'
                and "rentnerproxy"."proxy_hosts"."upstream_pool" ?& array['policy', 'members']
                and ("rentnerproxy"."proxy_hosts"."upstream_pool" - 'policy' - 'members') = '{}'::jsonb
                and jsonb_typeof("rentnerproxy"."proxy_hosts"."upstream_pool"->'policy') = 'string'
                and "rentnerproxy"."proxy_hosts"."upstream_pool"->>'policy' in ('round_robin', 'first')
                and jsonb_typeof("rentnerproxy"."proxy_hosts"."upstream_pool"->'members') = 'array'
                and jsonb_array_length("rentnerproxy"."proxy_hosts"."upstream_pool"->'members') between 1 and 16
                and not jsonb_path_exists("rentnerproxy"."proxy_hosts"."upstream_pool", '$.members[*] ? (@.type() != "object" || !exists(@.host) || !exists(@.port) || @.host.type() != "string" || @.host == "" || @.port.type() != "number" || @.port < 1 || @.port > 65535 || @.port.floor() != @.port)')
                and not jsonb_path_exists("rentnerproxy"."proxy_hosts"."upstream_pool", '$.members[*].keyvalue() ? (@.key != "host" && @.key != "port")')
                and "rentnerproxy"."proxy_hosts"."upstream_pool"->'members'->0->>'host' = "rentnerproxy"."proxy_hosts"."forward_host"
                and "rentnerproxy"."proxy_hosts"."upstream_pool"->'members'->0->'port' = to_jsonb("rentnerproxy"."proxy_hosts"."forward_port")
            ), false));