FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs app.js index.html styles.css account.css admin.css progress.css ./
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
