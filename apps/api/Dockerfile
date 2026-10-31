# syntax=docker/dockerfile:1.7
FROM node:22.17.1-bookworm-slim AS dependencies
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN npm ci

FROM dependencies AS build
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src apps/api/src
COPY apps/api/data/checkpoint-directory.v1.manifest.json apps/api/data/checkpoint-directory.v1.manifest.json
RUN DATABASE_URL=mysql://127.0.0.1:3306/build npm run prisma:generate
RUN npm run build:api

FROM dependencies AS migration
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
WORKDIR /workspace
CMD ["npm", "run", "db:migrate"]

FROM node:22.17.1-bookworm-slim AS production-dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN npm ci --omit=dev

FROM node:22.17.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /workspace/node_modules /app/node_modules
COPY --from=build --chown=node:node /workspace/apps/api/dist /app/apps/api/dist
COPY --from=build --chown=node:node /workspace/apps/api/data/checkpoint-directory.v1.manifest.json /app/apps/api/data/checkpoint-directory.v1.manifest.json
COPY --chown=node:node apps/api/package.json /app/apps/api/package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]
