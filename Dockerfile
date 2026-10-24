# LearnHarness headless server. Build context is the repo root.
# Native modules (@napi-rs/canvas, @resvg/resvg-js) install for this image's
# arch during `npm ci`, then the standalone trace picks them up.
#
# Interactive demos need a Chrome/Chromium binary and CHROME_PATH. PDF and
# SVG rendering do not.
FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && node scripts/build-server.mjs

ENV NODE_ENV=production \
	HOSTNAME=0.0.0.0 \
	PORT=3000 \
	LH_DATA_DIR=/data \
	LH_AUTH_FILE=/data/auth.json \
	LH_HEADLESS=1

EXPOSE 3000
VOLUME /data

WORKDIR /app/.next/standalone
CMD ["node", "server.js"]
