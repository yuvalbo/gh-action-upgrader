FROM node:20

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./
# Copy source code and config files
COPY . .

# Install dependencies
RUN npm install
RUN npm install @actions/core --save


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

ENTRYPOINT cp -r dist /usr/output && cp -r node_modules /usr/output
