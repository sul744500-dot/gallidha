FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3200 \
    TRUST_PROXY=1
COPY --from=build /app ./
EXPOSE 3200
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3200/healthz || exit 1
CMD ["npm", "start"]
