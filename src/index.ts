import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { compare, validate } from 'compare-versions';

// ... (previous interface and helper functions remain the same)

async function getLatestVersion(octokit: any, action: ActionReference): Promise<string | null> {
  const actionOwner = action.isGitHubAction ? 'actions' : action.owner;
  core.debug(`Fetching latest version for ${actionOwner}/${action.repo}`);
  
  // Determine the format of the current version
  const versionParts = action.currentVersion.replace(/^v/, '').split('.').length;
  
  try {
    // Get all releases
    const { data: releases } = await octokit.repos.listReleases({
      owner: actionOwner,
      repo: action.repo,
      per_page: 100
    });

    if (releases.length > 0) {
      // Filter valid versions and sort them
      const versions = releases
        .map(release => release.tag_name.replace(/^v/, ''))
        .filter(version => validate(version))
        .sort((a, b) => compare(b, a));

      if (versions.length === 0) {
        return null;
      }

      const latestFullVersion = versions[0];
      const majorVersion = latestFullVersion.split('.')[0];

      // If original version was major only (v3)
      if (versionParts === 1) {
        // First try to find a major-only version release (v4)
        const majorOnlyRelease = releases.find(release => 
          release.tag_name.replace(/^v/, '') === majorVersion ||
          release.tag_name === `v${majorVersion}`
        );

        if (majorOnlyRelease) {
          return majorOnlyRelease.tag_name;
        }

        // Then try to find major.minor version (v4.1)
        const majorMinorVersion = versions.find(version => {
          const parts = version.split('.');
          return parts.length === 2 && parts[0] === majorVersion;
        });

        if (majorMinorVersion) {
          return `v${majorMinorVersion}`;
        }

        // Finally, fall back to full version (v4.1.2)
        return `v${latestFullVersion}`;
      }
      
      // If original version was major.minor (v3.1)
      else if (versionParts === 2) {
        // Try to find latest major.minor version
        const majorMinorVersion = versions.find(version => {
          const parts = version.split('.');
          return parts.length === 2;
        });

        if (majorMinorVersion) {
          return `v${majorMinorVersion}`;
        }

        // Fall back to full version but only include major.minor
        const parts = latestFullVersion.split('.');
        return `v${parts[0]}.${parts[1]}`;
      }
      
      // If original version was major.minor.patch (v3.1.2)
      else {
        return `v${latestFullVersion}`;
      }
    }

    // If no releases found, try tags
    core.debug('No releases found, checking tags...');
    const { data: tags } = await octokit.repos.listTags({
      owner: actionOwner,
      repo: action.repo,
      per_page: 100
    });

    if (tags.length > 0) {
      const versions = tags
        .map(tag => tag.name.replace(/^v/, ''))
        .filter(version => validate(version))
        .sort((a, b) => compare(b, a));

      if (versions.length === 0) {
        return null;
      }

      const latestVersion = versions[0];
      const majorVersion = latestVersion.split('.')[0];

      // Apply the same version format logic as with releases
      if (versionParts === 1) {
        const majorOnlyTag = tags.find(tag => 
          tag.name.replace(/^v/, '') === majorVersion ||
          tag.name === `v${majorVersion}`
        );

        if (majorOnlyTag) {
          return majorOnlyTag.name;
        }

        const majorMinorVersion = versions.find(version => {
          const parts = version.split('.');
          return parts.length === 2 && parts[0] === majorVersion;
        });

        if (majorMinorVersion) {
          return `v${majorMinorVersion}`;
        }

        return `v${latestVersion}`;
      } else if (versionParts === 2) {
        const majorMinorVersion = versions.find(version => {
          const parts = version.split('.');
          return parts.length === 2;
        });

        if (majorMinorVersion) {
          return `v${majorMinorVersion}`;
        }

        const parts = latestVersion.split('.');
        return `v${parts[0]}.${parts[1]}`;
      } else {
        return `v${latestVersion}`;
      }
    }

    core.debug('No tags found');
    return null;
  } catch (error) {
    core.warning(`Failed to get version for ${actionOwner}/${action.repo}: ${error}`);
    return null;
  }
}

function isNewerVersion(current: string, latest: string): boolean {
  // Remove 'v' prefix if present
  current = current.replace(/^v/, '');
  latest = latest.replace(/^v/, '');
  
  // Validate versions
  if (!validate(current) || !validate(latest)) {
    core.debug(`Invalid version format: current=${current}, latest=${latest}`);
    return false;
  }

  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  try {
    // Compare based on the number of parts in the current version
    if (currentParts.length === 1) {
      // Only compare major versions
      return latestParts[0] > currentParts[0];
    } else if (currentParts.length === 2) {
      // Compare major and minor versions
      return (
        latestParts[0] > currentParts[0] || 
        (latestParts[0] === currentParts[0] && latestParts[1] > currentParts[1])
      );
    } else {
      // Compare full versions
      return (
        latestParts[0] > currentParts[0] ||
        (latestParts[0] === currentParts[0] && latestParts[1] > currentParts[1]) ||
        (latestParts[0] === currentParts[0] && latestParts[1] === currentParts[1] && latestParts[2] > currentParts[2])
      );
    }
  } catch (error) {
    core.warning(`Error comparing versions: ${error}`);
    return false;
  }
}
