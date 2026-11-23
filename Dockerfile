# One container: Bun serves the API, the sync socket and the built web app.
FROM oven/bun:1
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun run --cwd apps/web build
ENV SEIJAKU_DB=/data/seijaku.sqlite \
    SEIJAKU_BLOBS=/data/blobs \
    SEIJAKU_WEB=/app/apps/web/dist \
    PORT=8791
# The data folder belongs to the image's unprivileged user; the server needs nothing else writable.
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 8791
CMD ["bun", "apps/server/src/bun.ts"]
