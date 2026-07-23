FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS api

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production

RUN corepack enable \
    && corepack prepare pnpm@11.8.0 --activate

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
    && chmod 0755 /app/deploy/api-entrypoint.sh

ENTRYPOINT ["/app/deploy/api-entrypoint.sh"]
CMD ["pnpm", "--filter", "@proxysplit/api", "exec", "tsx", "src/server.ts"]
