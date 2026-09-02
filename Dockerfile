# Base común: sin npm global actualizado.
#
# `npm install -g npm@11.6.1` estaba acá y, como `runner` hereda de `base`, ese
# npm quedaba dentro de la imagen final. Trivy detectó que aportaba 28 de los 30
# hallazgos CRITICAL/HIGH de la imagen (tar, minimatch, glob, brace-expansion,
# ip-address), ninguno proveniente del código de la aplicación ni de sus
# dependencias. La actualización de npm sólo hace falta donde se instalan
# paquetes, así que ahora se aplica en los stages de build y no en el runtime.
FROM node:22.23.2-alpine3.24 AS base
WORKDIR /app
# La etiqueta de Node puede quedar unos días detrás de los repositorios de
# seguridad de Alpine. Aplicamos únicamente actualizaciones compatibles con la
# misma rama para que la imagen final no conserve CVE que ya tienen parche.
RUN apk upgrade --no-cache

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

# Runtime: npm y corepack no son necesarios para ejecutar la API. Se eliminan
# para que sus gestores de paquetes y descompresores no amplíen la superficie
# desplegada; el script de producción se ejecuta directamente con Node.
FROM base AS runner
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
COPY scripts/start-production.cjs ./scripts/start-production.cjs
COPY package*.json ./
RUN rm -rf \
    /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'4000')+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/start-production.cjs"]
