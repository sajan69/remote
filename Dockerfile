FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY gateway ./gateway
COPY web ./web
RUN npm ci
RUN npm run icons && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DATA_DIR=/data
ENV STATIC_DIR=/app/web/dist
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/gateway/package.json ./gateway/package.json
COPY --from=build /app/gateway/dist ./gateway/dist
COPY --from=build /app/web/package.json ./web/package.json
COPY --from=build /app/web/dist ./web/dist
RUN npm ci --omit=dev
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "gateway/dist/server.js"]
