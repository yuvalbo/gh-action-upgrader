# GitHub Action Version Updater

A GitHub Action that automatically checks and updates versions of third-party actions used in your workflows.

## Description

The GitHub Action Version Updater scans the `.github/workflows` directory of your repository and identifies any third-party actions being used (excluding GitHub-owned actions). It then checks the latest available version for each action and creates a pull request to update the workflow file(s) if a newer version is found.

This helps you keep your workflows up-to-date with the latest versions of the actions you're using, reducing the risk of relying on outdated functionality or missing bug fixes and security patches.

## Features

- Automatically detects third-party actions in your workflow files
- Checks for the latest available version using both releases and tags
- Compares versions using robust semantic versioning comparison
- Creates separate pull requests for each action that needs updating
- Provides detailed error handling and logging
- Supports customizable branch naming and PR templates

## Usage

To use the GitHub Action Version Updater, add the following workflow to your repository:

```yaml
name: Update Action Versions
on:
  schedule:
    - cron: '0 0 * * 0'  # Run weekly
  workflow_dispatch:      # Allow manual triggers

jobs:
  update-actions:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v3
      - uses: your-username/action-updater@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
