FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS api

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production

RUN corepack enable \
    && corepack prepare pnpm@11.8.0 --activate

WORKDIR /app
COPY . .
# The production host reaches registry.npmjs.org slowly and pnpm install times
# out on cold cache (e.g. after new deps land). Pull tarballs from the faithful
# npmmirror mirror (identical integrity hashes, so --frozen-lockfile still
# validates) and give the network generous timeout/retries.
RUN pnpm config set registry https://registry.npmmirror.com \
    && pnpm config set fetch-timeout 600000 \
    && pnpm config set fetch-retries 5 \
    && pnpm install --frozen-lockfile \
    && chmod 0755 /app/deploy/api-entrypoint.sh

ENTRYPOINT ["/app/deploy/api-entrypoint.sh"]
CMD ["pnpm", "--filter", "@proxysplit/api", "exec", "tsx", "src/server.ts"]
