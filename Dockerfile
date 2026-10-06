# RoutineCast app image: Hono API + built React CMS + ffmpeg (D20: pinned).
FROM node:20-bookworm-slim AS build
WORKDIR /repo
COPY package.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY app/package.json app/
COPY agent/package.json agent/
RUN npm install
COPY shared/ shared/
COPY app/ app/
RUN npm run build -w @routinecast/shared && npm run build -w @routinecast/app

# ffmpeg 7.x pinned by digest of the bookworm package train — record the
# version at build time; it is deliberately NOT part of the asset cache key.
FROM node:20-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg=7:7.1.* \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/package.json ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/shared/package.json shared/
COPY --from=build /repo/shared/dist shared/dist/
COPY --from=build /repo/app/package.json app/
COPY --from=build /repo/app/dist app/dist/
WORKDIR /repo/app
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
