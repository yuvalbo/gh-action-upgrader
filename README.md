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
```

The action requires the following permissions:

* `contents: write` - To create branches and commit changes
* `pull-requests: write` - To create pull requests

## Configuration
The GitHub Action Version Updater has the following input:
| Input          | Description                         | Default             |
|----------------|-------------------------------------|---------------------|
| `github-token` | GitHub token for API authentication | ${{ github.token }} |

## Contributing
Contributions to the GitHub Action Version Updater are welcome! If you have any ideas for improvement or encounter any issues, please feel free to open an issue or submit a pull request.
## License
This project is licensed under the MIT License.

This README covers the key aspects of the GitHub Action, including:

- Description of the action's purpose and features
- Usage instructions and configuration
- Required permissions
- Contributing guidelines
- License information

Feel free to customize this README further to match your project's specific details and requirements. Let me know if you need any clarification or have additional requests.
