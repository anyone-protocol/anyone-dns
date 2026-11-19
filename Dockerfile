FROM docker.io/library/node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
WORKDIR /usr/src/app
COPY --chown=node:node . .
RUN npm ci
RUN npm run build
ENV NODE_ENV=production
USER node

FROM docker.io/library/node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS deploy
COPY --chown=node:node --from=build /usr/src/app/node_modules ./node_modules
COPY --chown=node:node --from=build /usr/src/app/dist ./dist
ENV NODE_OPTIONS=--max-old-space-size=2048
CMD [ "node", "dist/main.js" ]
