# Use an official Node.js image as the base
FROM node:20

# Set the working directory in the container
WORKDIR /usr/src/app

# Install TypeScript globally to ensure tsc is available
RUN npm install -g typescript

# Copy only package.json and package-lock.json to leverage Docker cache for dependencies
COPY package*.json ./

# Install all project dependencies (including dev dependencies)
RUN npm install

# Copy the rest of the application code
COPY . .

# Run the build script defined in package.json
RUN npm run build

# Default command (optional): list contents of the dist folder to verify the build
CMD ["ls", "-l", "dist"]
