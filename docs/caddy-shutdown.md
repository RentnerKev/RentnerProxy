# Caddy shutdown budgets

The production Compose service allows 30 seconds for container stop. The appliance supervisor allows 25 seconds for its children; the web process has its own 18-second limit.

The controller gives Caddy a separate shutdown budget: at most 20 seconds for the authenticated local `/stop` control exchange, with a shared 22-second deadline for that exchange and the owned child to exit. Time spent on the control exchange is deducted from the child drain budget. Failed control, a stuck request, or failure to exit triggers termination of only the owned Caddy child, followed by at most one second of reaping. A nonzero child exit is reported as a shutdown failure.

Ordinary admin/load/metrics requests retain their ten-second timeout, and runtime revision probes retain their three-second limit. Response bounds, controller authentication, and CrowdSec policy are unchanged. Requests still running after the shutdown deadline can be interrupted; the limit does not promise completion of arbitrarily long requests.

The independent CI smoke `.github/scripts/ci/appliance-drain-smoke.ts` creates a fresh production appliance, database volume, private network and Bun upstream container. It imports a local fixture certificate through the authenticated controller, enables managed CrowdSec, then admits concurrent HTTP and CA-verified HTTPS requests before stopping the appliance. Sixteen-second requests must complete. Sixty-second requests must be interrupted within the bounded drain window, with normal container exit and no Docker SIGKILL or OOM. All resources, including image-declared anonymous volumes, belong to the test and are removed afterwards.

Run the smoke against an already-built image with `bun --no-env-file .github/scripts/ci/appliance-drain-smoke.ts --image IMAGE`. Omit `--image` to build the production Dockerfile for CI. Optional `--output PATH` saves sanitized timing, response and lifecycle evidence. Existing image migrations run only through normal startup in the newly-created isolated database; the smoke does not inspect or change migration sources.
