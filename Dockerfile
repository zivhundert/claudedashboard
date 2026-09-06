FROM node:22-slim AS build
RUN npm install -g pnpm@9
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @dash/server deploy --prod /out

FROM node:22-slim
WORKDIR /app
COPY --from=build /out /app
COPY --from=build /app/web/dist /app/web/dist
ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/app/data/dashboard.db \
    WEB_DIST_PATH=/app/web/dist
VOLUME /app/data
# Dashboard/API port; publish OTEL_PORT too when the receiver runs on its own
# listener (e.g. -p 8642:8642 -p 9000:9000 with PORT=8642 OTEL_PORT=9000).
EXPOSE 8080
# Follows PORT so an --env-file override does not leave the container "unhealthy".
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
