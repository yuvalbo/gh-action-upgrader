FROM node:20

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code and config files
COPY . .

# Install dev dependencies
RUN npm install --save-dev @types/js-yaml

# Debug: List contents before build
RUN echo "Contents before build:" && ls -la

# Build TypeScript code
RUN npm run build

# Debug: List contents after build
RUN echo "Contents after build:" && ls -la
RUN echo "Contents of dist directory:" && ls -la dist || echo "dist directory not found"
RUN echo "Contents of src directory:" && ls -la src || echo "src directory not found"

RUN mkdir /usr/src/app/out
RUN cp dist/index.js /usr/src/app/out
RUN echo "Contents of out directory:" && ls -la /usr/src/app/out || echo "/usr/src/app/out directory not found"
