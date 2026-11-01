# Google's Docker Hub cache serves the same pinned bytes without CI's shared Docker Hub pull quota.
FROM mirror.gcr.io/library/alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a AS build
RUN apk add --no-cache build-base pkgconf gnutls-dev nghttp2-dev nghttp3-dev ngtcp2-dev zlib-dev
ADD --checksum=sha256:8dadd7d2536a314f982ad05a651b713f426bf7d02cc2c76cffb9796f2218e6c5 https://curl.se/download/curl-8.23.0.tar.xz /tmp/curl.tar.xz
WORKDIR /build
RUN tar -xJf /tmp/curl.tar.xz --strip-components=1 && \
    ./configure --with-gnutls --with-nghttp2 --with-nghttp3 --with-ngtcp2 \
      --disable-shared --enable-static --disable-docs --disable-manual \
      --disable-ldap --disable-ldaps --without-libpsl --without-brotli --without-zstd && \
    make -j2 && make install

FROM mirror.gcr.io/library/alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a
RUN apk add --no-cache ca-certificates gnutls nghttp2-libs nghttp3 ngtcp2 ngtcp2-gnutls zlib
COPY --from=build /usr/local/bin/curl /usr/local/bin/curl
COPY --from=build /build/COPYING /usr/share/licenses/curl/COPYING
RUN curl --version | grep -q 'HTTP3'
USER 65532:65532
ENTRYPOINT ["curl"]
