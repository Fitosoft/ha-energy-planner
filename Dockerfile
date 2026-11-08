FROM node:24-alpine
WORKDIR /app
COPY package.json config.example.json ./
COPY src ./src
COPY examples ./examples
ENV NODE_ENV=production
EXPOSE 8099
CMD ["node", "src/service.mjs"]
