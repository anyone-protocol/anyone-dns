FROM docker.io/library/node:24.22.1-alpine3.24@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build
WORKDIR /usr/src/app
COPY --chown=node:node . .
RUN npm ci
RUN npm run build
ENV NODE_ENV=production
USER node

FROM docker.io/library/node:24.22.1-alpine3.24@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS deploy
COPY --chown=node:node --from=build /usr/src/app/node_modules ./node_modules
COPY --chown=node:node --from=build /usr/src/app/dist ./dist
ENV NODE_OPTIONS=--max-old-space-size=2048
CMD [ "node", "dist/main.js" ]
