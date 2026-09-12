FROM alpine:3.23@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40 AS build
RUN apk add --no-cache build-base pkgconf gnutls-dev nghttp2-dev nghttp3-dev ngtcp2-dev zlib-dev
ADD --checksum=sha256:f7ef3ae8a22e521f289803fe93543eb64c329b58aa73a9e224dfd915a2a5f4f7 https://curl.se/download/curl-8.22.0.tar.xz /tmp/curl.tar.xz
WORKDIR /build
RUN tar -xJf /tmp/curl.tar.xz --strip-components=1 && \
    ./configure --with-gnutls --with-nghttp2 --with-nghttp3 --with-ngtcp2 \
      --disable-shared --enable-static --disable-docs --disable-manual \
      --disable-ldap --disable-ldaps --without-libpsl --without-brotli --without-zstd && \
    make -j2 && make install

FROM alpine:3.23@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40
RUN apk add --no-cache ca-certificates gnutls nghttp2-libs nghttp3 ngtcp2 ngtcp2-gnutls zlib
COPY --from=build /usr/local/bin/curl /usr/local/bin/curl
COPY --from=build /build/COPYING /usr/share/licenses/curl/COPYING
RUN curl --version | grep -q 'HTTP3'
USER 65532:65532
ENTRYPOINT ["curl"]
