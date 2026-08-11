FROM node:22-alpine AS base
WORKDIR /app
RUN npm install -g npm@11.6.1

FROM base AS deps
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS prod-deps
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS runner
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
COPY scripts ./scripts
COPY package*.json ./
USER node
EXPOSE 4000
CMD ["npm", "run", "start:prod"]
