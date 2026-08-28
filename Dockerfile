# Base común: sin npm global actualizado.
#
# `npm install -g npm@11.6.1` estaba acá y, como `runner` hereda de `base`, ese
# npm quedaba dentro de la imagen final. Trivy detectó que aportaba 28 de los 30
# hallazgos CRITICAL/HIGH de la imagen (tar, minimatch, glob, brace-expansion,
# ip-address), ninguno proveniente del código de la aplicación ni de sus
# dependencias. La actualización de npm sólo hace falta donde se instalan
# paquetes, así que ahora se aplica en los stages de build y no en el runtime.
FROM node:26-alpine AS base
WORKDIR /app

# Stage intermedio para todo lo que ejecuta npm ci / npm run build.
FROM base AS toolchain
RUN npm install -g npm@11.6.1

FROM toolchain AS deps
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM toolchain AS prod-deps
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Runtime: parte de `base`, que conserva el npm que trae node:22-alpine.
# Sólo se usa para resolver `npm run start:prod`.
FROM base AS runner
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
COPY scripts ./scripts
COPY package*.json ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start:prod"]
