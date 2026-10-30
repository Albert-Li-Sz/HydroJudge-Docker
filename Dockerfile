# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
ARG NIX_IMAGE=nixos/nix@sha256:f159a58f390677f41e8e900a74b6e2f9c7f27b364122ae6acf7a652ce6c551c0

FROM ${NIX_IMAGE} AS toolchain
ARG TARGETARCH
ENV NIX_CONFIG="sandbox = false"
WORKDIR /build
COPY nix/ ./nix/
RUN test "${TARGETARCH}" = amd64 || { echo 'Only linux/amd64 is supported' >&2; exit 1; }
# QEMU user-mode builds cannot install Nix's builder seccomp filter. This only
# affects the build stage; the runtime go-judge seccomp policy stays enabled.
RUN set -eu; \
    rootfs="$(nix-build ./nix/default.nix --no-out-link --option filter-syscalls false)"; \
    mkdir -p /closure /out; \
    nix-store --query --requisites "$rootfs" > /out/closure-paths; \
    while IFS= read -r store_path; do cp -a "$store_path" /closure/; done < /out/closure-paths; \
    printf '%s\n' "$rootfs" > /out/rootfs-path

ARG GO_JUDGE_VERSION=1.13.3
ARG GO_JUDGE_SHA256=509782f8959987256d99ac6dc8062ec593d776f291401c8e0c28bdc48dcd1880
RUN set -eu; \
    curl --fail --location --retry 3 \
      "https://github.com/criyle/go-judge/releases/download/v${GO_JUDGE_VERSION}/go-judge_${GO_JUDGE_VERSION}_linux_amd64" \
      --output /out/go-judge; \
    printf '%s  %s\n' "$GO_JUDGE_SHA256" /out/go-judge | sha256sum --check --strict; \
    chmod 0755 /out/go-judge; \
    printf '%s\n' "$GO_JUDGE_VERSION" > /out/go-judge-version

FROM ${NODE_IMAGE} AS dependencies
ARG TARGETARCH
WORKDIR /opt/hydrojudge
COPY package.json package-lock.json ./
COPY patches/ ./patches/
RUN test "${TARGETARCH}" = amd64 || { echo 'Only linux/amd64 is supported' >&2; exit 1; }
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && node patches/hydrojudge-output-limit.cjs \
    && node patches/hydrojudge-reliability.cjs

FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.title="Hydro independent judge" \
      org.opencontainers.image.description="Hydro judge with Nix C/C++, Java 21, CPython and PyPy toolchains for linux/amd64"
ENV USER=root \
    LANG=C.UTF-8 \
    NODE_ENV=production \
    CONFIG_FILE=/config/judge.yaml \
    PATH=/opt/hydrojudge/node_modules/.bin:/opt/judge-rootfs/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    SSL_CERT_FILE=/opt/judge-rootfs/etc/ssl/certs/ca-bundle.crt \
    NODE_EXTRA_CA_CERTS=/opt/judge-rootfs/etc/ssl/certs/ca-bundle.crt
WORKDIR /opt/hydrojudge
COPY --from=toolchain /closure/ /nix/store/
COPY --from=toolchain /out/rootfs-path /out/closure-paths /out/go-judge-version ./build-info/
COPY --from=toolchain /out/go-judge /usr/local/bin/go-judge
COPY --from=dependencies /opt/hydrojudge/ ./
COPY runtime/ ./runtime/
COPY config/mount.yaml ./mount.yaml
RUN set -eu; \
    ln -s "$(cat build-info/rootfs-path)" /opt/judge-rootfs; \
    ln -s /usr/local/bin/go-judge /usr/local/bin/hydro-sandbox; \
    chmod 0755 runtime/entrypoint.sh; \
    mkdir -p /config /var/cache/hydrojudge /tmp/hydrojudge /run/hydrojudge; \
    chmod 0700 /run/hydrojudge
USER root
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ["node", "/opt/hydrojudge/runtime/healthcheck.cjs"]
ENTRYPOINT ["/opt/judge-rootfs/bin/tini", "-g", "--", "/opt/hydrojudge/runtime/entrypoint.sh"]
CMD ["run"]
