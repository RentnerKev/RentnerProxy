FROM mirror.gcr.io/oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d

USER root
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        apt-utils ca-certificates cpio createrepo-c curl dpkg-dev git gnupg gpgv \
        iproute2 podman rpm rpm2cpio shellcheck skopeo systemd systemd-container \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work
ENTRYPOINT ["bun", "--no-env-file"]
