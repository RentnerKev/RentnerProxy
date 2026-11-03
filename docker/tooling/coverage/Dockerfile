FROM mirror.gcr.io/oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS bun

FROM mirror.gcr.io/library/postgres:18.6@sha256:3a4264520e121176619f54ff867d12774bc81e95e7b84db58d63bccdb6144b81
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10002 rentnerproxy \
    && useradd --uid 10002 --gid rentnerproxy --no-create-home rentnerproxy \
    && groupadd --gid 10003 crowdsec \
    && useradd --uid 10003 --gid crowdsec --no-create-home crowdsec \
    && git config --system --add safe.directory /workspace

WORKDIR /workspace
ENTRYPOINT ["bun", "--no-env-file"]
