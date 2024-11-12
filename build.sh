#!/bin/bash

# Build the Docker image
docker build -t github-action-builder .

# Run the Docker container, mounting the output directory to your host machine
docker run --rm -v $(pwd)/dist:/usr/src/app/dist github-action-builder
