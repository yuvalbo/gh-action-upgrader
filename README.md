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
          github-token: ${{ secrets.WORKFLOW_TOKEN }}
```

The action requires the following permissions:

* `contents: write` - To create branches and commit changes
* `pull-requests: write` - To create pull requests
* `WORKFLOW_TOKEN` - In order to create a PR that changes the files under the `.github/workflow` directory, you will need to set up a token that has `workflow` permissions.

## Configuration
The GitHub Action Version Updater has the following input:
| Input          | Description                         | Default             |
|----------------|-------------------------------------|---------------------|
| `github-token` | GitHub token for API authentication | ${{ github.token }} |

## Contributing
Contributions to the GitHub Action Version Updater are welcome! If you have any ideas for improvement or encounter any issues, please feel free to open an issue or submit a pull request.

# License and Third-Party Attribution

## Project License
MIT License

Copyright (c) 2024

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Third-Party Dependencies

This action uses the following third-party packages:

### Production Dependencies

| Package | Version | License | Repository |
|---------|---------|---------|------------|
| @actions/core | ^1.10.1 | MIT | https://github.com/actions/toolkit |
| @actions/github | ^6.0.0 | MIT | https://github.com/actions/toolkit |
| @octokit/rest | ^20.0.2 | MIT | https://github.com/octokit/rest.js |
| js-yaml | ^4.1.0 | MIT | https://github.com/nodeca/js-yaml |
| compare-versions | ^6.1.0 | MIT | https://github.com/omichelsen/compare-versions |

### Development Dependencies

| Package | Version | License | Repository |
|---------|---------|---------|------------|
| @types/node | ^20.11.0 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/js-yaml | ^4.0.9 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| typescript | ^5.3.3 | Apache-2.0 | https://github.com/microsoft/TypeScript |

## Usage Terms

This GitHub Action is provided under the MIT License. When using this action, you agree to:

1. Comply with all applicable laws and GitHub's terms of service
2. Only use the action for lawful purposes
3. Not use the action in any way that could harm GitHub's systems or other users

## Support

For support, please open an issue in the GitHub repository.

## Privacy

This action does not collect any personal information. It only accesses:
- Your repository's workflow files
- Public GitHub API data for action versions
