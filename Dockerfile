# Use an official Node.js image as the base
FROM node:20

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy only package.json and package-lock.json to leverage Docker cache for dependencies
COPY package*.json ./

# Install all dependencies (including TypeScript as a dev dependency)
RUN npm install --include=dev

# Copy the rest of the application code
COPY . .

# Run the build script defined in package.json
RUN npm run build

# Default command (optional): list contents of the dist folder to verify the build
CMD ["ls", "-l", "dist"]
