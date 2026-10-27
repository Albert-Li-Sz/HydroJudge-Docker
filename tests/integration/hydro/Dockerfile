FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
WORKDIR /opt/test-site
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
ENV PATH=/opt/test-site/node_modules/.bin:$PATH
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]
