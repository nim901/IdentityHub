# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build
FROM build AS test
CMD ["npm", "test"]
FROM build AS mock
USER node
EXPOSE 4010
CMD ["npm", "run", "mock:atlassian"]
FROM build AS runtime-prep
RUN npm prune --omit=dev
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=runtime-prep /repo /repo
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
