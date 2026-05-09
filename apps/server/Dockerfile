# Multi-stage build for the BaaS server. Distroless final image; root-less.
ARG NODE_VERSION=20.10.0

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY pnpm-workspace.yaml package.json .npmrc ./
COPY apps/server/package.json apps/server/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/api-types/package.json packages/api-types/package.json
RUN pnpm install --frozen-lockfile --filter @eveys-console/server...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/server apps/server
RUN pnpm --filter @eveys-console/server build

FROM gcr.io/distroless/nodejs20-debian12:nonroot AS runtime
WORKDIR /app
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/server/package.json ./package.json
EXPOSE 8090
USER nonroot
CMD ["dist/main.js"]
