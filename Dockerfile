# Use a Node.js image
FROM node:20

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json first to install dependencies
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all the source files
COPY . .

# Install type definitions for js-yaml (and other missing types, if any)
RUN npm i --save-dev @types/js-yaml

# Build the project
RUN npm run build

# Set the default command to run the built file (if needed)
CMD ["node", "dist/index.js"]
