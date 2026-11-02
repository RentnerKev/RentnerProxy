ALTER TABLE "rentnerproxy"."proxy_hosts" DROP CONSTRAINT "proxy_hosts_upstream_pool_check";--> statement-breakpoint
ALTER TABLE "rentnerproxy"."proxy_hosts" ADD CONSTRAINT "proxy_hosts_upstream_pool_check" CHECK ("rentnerproxy"."proxy_hosts"."upstream_pool" is null or coalesce((
                jsonb_typeof("rentnerproxy"."proxy_hosts"."upstream_pool") = 'object'
                and "rentnerproxy"."proxy_hosts"."upstream_pool" ?& array['policy', 'members']
                and ("rentnerproxy"."proxy_hosts"."upstream_pool" - 'policy' - 'members' - 'failover') = '{}'::jsonb
                and jsonb_typeof("rentnerproxy"."proxy_hosts"."upstream_pool"->'policy') = 'string'
                and "rentnerproxy"."proxy_hosts"."upstream_pool"->>'policy' in ('round_robin', 'first')
                and jsonb_typeof("rentnerproxy"."proxy_hosts"."upstream_pool"->'members') = 'array'
                and jsonb_array_length("rentnerproxy"."proxy_hosts"."upstream_pool"->'members') between 1 and 16
                and not jsonb_path_exists("rentnerproxy"."proxy_hosts"."upstream_pool", '$.members[*] ? (@.type() != "object" || !exists(@.host) || !exists(@.port) || @.host.type() != "string" || @.host == "" || @.port.type() != "number" || @.port < 1 || @.port > 65535 || @.port.floor() != @.port)')
                and not jsonb_path_exists("rentnerproxy"."proxy_hosts"."upstream_pool", '$.members[*].keyvalue() ? (@.key != "host" && @.key != "port")')
                and "rentnerproxy"."proxy_hosts"."upstream_pool"->'members'->0->>'host' = "rentnerproxy"."proxy_hosts"."forward_host"
                and "rentnerproxy"."proxy_hosts"."upstream_pool"->'members'->0->'port' = to_jsonb("rentnerproxy"."proxy_hosts"."forward_port")
                and (not ("rentnerproxy"."proxy_hosts"."upstream_pool" ? 'failover') or (
                    jsonb_typeof(("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')) = 'object'
                    and ("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover') <> '{}'::jsonb
                    and (("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover') - 'active' - 'passive' - 'retries') = '{}'::jsonb
                    and (not (("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover') ? 'active') or (
                    jsonb_typeof((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')) = 'object'
                    and (("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active') ?& array['path', 'intervalSeconds', 'timeoutSeconds', 'fails', 'passes', 'expectedStatus']
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active') - 'path' - 'intervalSeconds' - 'timeoutSeconds' - 'fails' - 'passes' - 'expectedStatus') = '{}'::jsonb
                    and jsonb_typeof((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->'intervalSeconds') = 'number'
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'intervalSeconds')::numeric between 5 and 300
                    and trunc(((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'intervalSeconds')::numeric) = ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'intervalSeconds')::numeric
                    and jsonb_typeof((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->'timeoutSeconds') = 'number'
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'timeoutSeconds')::numeric between 1 and 30
                    and trunc(((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'timeoutSeconds')::numeric) = ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'timeoutSeconds')::numeric
                    and jsonb_typeof((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->'fails') = 'number'
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'fails')::numeric between 1 and 10
                    and trunc(((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'fails')::numeric) = ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'fails')::numeric
                    and jsonb_typeof((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->'passes') = 'number'
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'passes')::numeric between 1 and 10
                    and trunc(((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'passes')::numeric) = ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'passes')::numeric
                    and jsonb_typeof((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->'expectedStatus') = 'number'
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'expectedStatus')::numeric between 200 and 399
                    and trunc(((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'expectedStatus')::numeric) = ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'expectedStatus')::numeric
                    and jsonb_typeof((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->'path') = 'string'
                    and length(((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'path')) between 1 and 2048
                    and left(((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'path'), 1) = '/' and left(((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'path'), 2) <> '//'
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'path') !~ '[^!-~]'
                    and position('#' in ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'path')) = 0
                    and position(chr(92) in ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'path')) = 0
                    and position('{' in ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'path')) = 0 and position('}' in ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'path')) = 0
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'path') !~ '%([^0-9A-Fa-f]|[0-9A-Fa-f]([^0-9A-Fa-f]|$)|$)'
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'timeoutSeconds')::numeric <= ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'active')->>'intervalSeconds')::numeric
                ))
                    and (not (("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover') ? 'passive') or (
                    jsonb_typeof((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'passive')) = 'object'
                    and (("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'passive') ?& array['failDurationSeconds', 'maxFails']
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'passive') - 'failDurationSeconds' - 'maxFails') = '{}'::jsonb
                    and jsonb_typeof((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'passive')->'failDurationSeconds') = 'number'
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'passive')->>'failDurationSeconds')::numeric between 1 and 300
                    and trunc(((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'passive')->>'failDurationSeconds')::numeric) = ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'passive')->>'failDurationSeconds')::numeric
                    and jsonb_typeof((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'passive')->'maxFails') = 'number'
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'passive')->>'maxFails')::numeric between 1 and 10
                    and trunc(((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'passive')->>'maxFails')::numeric) = ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'passive')->>'maxFails')::numeric
                ))
                    and (not (("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover') ? 'retries') or (
                    jsonb_typeof((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries')) = 'object'
                    and (("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries') ?& array['maxRetries', 'tryDurationSeconds', 'tryIntervalMilliseconds']
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries') - 'maxRetries' - 'tryDurationSeconds' - 'tryIntervalMilliseconds') = '{}'::jsonb
                    and jsonb_typeof((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries')->'maxRetries') = 'number'
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries')->>'maxRetries')::numeric between 1 and 15
                    and trunc(((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries')->>'maxRetries')::numeric) = ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries')->>'maxRetries')::numeric
                    and jsonb_typeof((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries')->'tryDurationSeconds') = 'number'
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries')->>'tryDurationSeconds')::numeric between 1 and 30
                    and trunc(((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries')->>'tryDurationSeconds')::numeric) = ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries')->>'tryDurationSeconds')::numeric
                    and jsonb_typeof((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries')->'tryIntervalMilliseconds') = 'number'
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries')->>'tryIntervalMilliseconds')::numeric between 100 and 5000
                    and trunc(((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries')->>'tryIntervalMilliseconds')::numeric) = ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries')->>'tryIntervalMilliseconds')::numeric
                    and ("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover') ? 'passive'
                    and ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries')->>'tryIntervalMilliseconds')::numeric <= ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries')->>'tryDurationSeconds')::numeric * 1000
                    and ("rentnerproxy"."proxy_hosts"."upstream_pool"->>'policy' <> 'first' or ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'retries')->>'maxRetries')::numeric >= ((("rentnerproxy"."proxy_hosts"."upstream_pool"->'failover')->'passive')->>'maxFails')::numeric)
                ))
                ))
            ), false));