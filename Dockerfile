FROM node:22-alpine AS build

WORKDIR /app

# Prisma's config requires a datasource URL while generating the client.
# This is only a build-time placeholder; the runtime value must be supplied
# through the deployment environment.
ENV DATABASE_URL=postgresql://ci:ci@localhost:5432/pitchwork_ci

COPY package*.json ./
COPY prisma ./prisma

RUN npm ci --ignore-scripts

COPY . .

RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000

CMD ["node", "dist/src/main"]
