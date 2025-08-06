FROM mcr.microsoft.com/playwright:v1.43.1-jammy

# Instala Puppeteer
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install

# Copia o restante do projeto
COPY . .

# Compila projeto Nest
RUN yarn build

CMD ["yarn", "start"]