FROM node:lts-alpine3.21 AS build
WORKDIR /usr/src/app
COPY --chown=node:node . .
RUN npm ci
RUN npm run build
ENV NODE_ENV=production
USER node

FROM node:lts-alpine3.21 AS deploy
COPY --chown=node:node --from=build /usr/src/app/node_modules ./node_modules
COPY --chown=node:node --from=build /usr/src/app/dist ./dist
ENV NODE_OPTIONS=--max-old-space-size=2048
CMD [ "node", "dist/main.js" ]
