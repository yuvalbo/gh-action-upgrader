import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { compare, validate } from 'compare-versions';

interface Release {
  tag_name: string;
}

interface Tag {
  name: string;
}

interface VersionInfo {
  major: number;
  minor?: number;
  patch?: number;
  raw: string;
}

interface ActionReference {
  owner: string;
  repo: string;
  currentVersion: string;
  filePath: string;
  isGitHubAction: boolean;
}

async function run(): Promise<void> {
  try {
    core.info('Starting GitHub Action Version Checker');
    
    // Dynamically import the `Octokit` library inside the function to avoid TypeScript issues
    const { Octokit } = await import('@octokit/rest');

    // Get inputs
    const token = core.getInput('github-token', { required: true });
    const octokit = new Octokit({ auth: token });
    const { owner, repo } = github.context.repo;

    core.info(`Checking repository: ${owner}/${repo}`);

    // Scan .github directory
    core.info('Starting workflow files scan...');
    const actionsToUpdate = await scanWorkflowFiles(owner, repo);
    core.info(`Found ${actionsToUpdate.length} actions to check for updates`);
    
    let updateCount = 0;
    for (const action of actionsToUpdate) {
      core.info(`\nChecking updates for ${action.owner}/${action.repo}@${action.currentVersion}`);
      core.info(`Type: ${action.isGitHubAction ? 'GitHub Action' : 'Third-party Action'}`);
      
      const latestVersion = await getLatestVersion(octokit, action);
      
      if (!latestVersion) {
        core.warning(`Could not determine latest version for ${action.owner}/${action.repo}`);
        continue;
      }
      
      core.info(`Current version: ${action.currentVersion}`);
      core.info(`Latest version: ${latestVersion}`);
      
      if (isNewerVersion(action.currentVersion, latestVersion)) {
        core.info(`Update available for ${action.owner}/${action.repo}: ${action.currentVersion} → ${latestVersion}`);
        await createPullRequest(octokit, action, latestVersion);
        updateCount++;
      } else {
        core.info(`${action.owner}/${action.repo} is up to date`);
      }
    }
    
    core.info(`\nScan complete. Created ${updateCount} update PRs.`);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

async function scanWorkflowFiles(owner: string, repo: string): Promise<ActionReference[]> {
  const actions: ActionReference[] = [];
  const githubDir = '.github';
  const workflowsDir = path.join(githubDir, 'workflows');

  if (!fs.existsSync(workflowsDir)) {
    core.warning('No .github/workflows directory found');
    return actions;
  }

  const files = fs.readdirSync(workflowsDir);
  core.info(`Found ${files.length} workflow files to scan`);
  
  for (const file of files) {
    if (file.endsWith('.yml') || file.endsWith('.yaml')) {
      const filePath = path.join(workflowsDir, file);
      core.info(`\nScanning workflow file: ${file}`);
      
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const workflow = yaml.load(content) as any;
        const fileActions = extractActionsFromWorkflow(workflow, filePath);
        actions.push(...fileActions);
        core.info(`Found ${fileActions.length} actions in ${file}`);
      } catch (error) {
        core.warning(`Error parsing workflow file ${file}: ${error}`);
      }
    }
  }

  return actions;
}

function extractActionsFromWorkflow(workflow: any, filePath: string): ActionReference[] {
  const actions: ActionReference[] = [];

  // Recursive function to find actions in steps
  function processSteps(steps: any[]) {
    for (const step of steps) {
      if (step.uses) {
        const [ownerRepo, version] = step.uses.split('@');
        const [owner, repo] = ownerRepo.split('/');
        
        // Process both GitHub actions and third-party actions (excluding local actions)
        if (owner && repo && !step.uses.startsWith('./')) {
          core.debug(`Found action: ${owner}/${repo}@${version}`);
          actions.push({
            owner,
            repo,
            currentVersion: version,
            filePath,
            isGitHubAction: owner === 'actions'
          });
        }
      }
    }
  }

  // Process all jobs
  if (workflow.jobs) {
    core.debug(`Processing ${Object.keys(workflow.jobs).length} jobs`);
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      core.debug(`Processing job: ${jobName}`);
      if ((job as any).steps) {
        processSteps((job as any).steps);
      }
    }
  }

  return actions;
}

function parseVersion(version: string): VersionInfo {
  const cleanVersion = version.replace(/^v/, '');
  const parts = cleanVersion.split('.').map(Number);
  
  return {
    major: parts[0],
    minor: parts.length > 1 ? parts[1] : undefined,
    patch: parts.length > 2 ? parts[2] : undefined,
    raw: cleanVersion
  };
}

async function getLatestVersion(octokit: any, action: ActionReference): Promise<string | null> {
  const actionOwner = action.isGitHubAction ? 'actions' : action.owner;
  core.debug(`Fetching latest version for ${actionOwner}/${action.repo}`);
  
  try {
    // Get all releases
    const { data: releases } = await octokit.repos.listReleases({
      owner: actionOwner,
      repo: action.repo,
      per_page: 100
    });

    // Parse current version
    const currentVersion = parseVersion(action.currentVersion);
    
    // Get all valid versions from releases
    const allVersions = releases
      .map((release: Release) => parseVersion(release.tag_name))
      .filter((v: VersionInfo) => validate(v.raw));

    if (allVersions.length === 0) {
      return null;
    }

    // Sort versions by major, minor, patch
    allVersions.sort((a: VersionInfo, b: VersionInfo) => {
      if (a.major !== b.major) return b.major - a.major;
      if (a.minor !== undefined && b.minor !== undefined) {
        if (a.minor !== b.minor) return b.minor - a.minor;
      }
      if (a.patch !== undefined && b.patch !== undefined) {
        return b.patch - a.patch;
      }
      return 0;
    });

    // Get latest full version
    const latestVersion = allVersions[0];

    // If no newer major version exists, no upgrade needed
    if (latestVersion.major <= currentVersion.major) {
      return null;
    }

    core.debug(`Current version format: ${currentVersion.minor === undefined ? 'major' : 
               currentVersion.patch === undefined ? 'major.minor' : 'major.minor.patch'}`);

    // Case 1: Original version is major only (e.g., v3)
    if (currentVersion.minor === undefined) {
      // First try to find a major-only release of the new version
      const majorOnlyRelease = releases.find((release: Release) => {
        const version = parseVersion(release.tag_name);
        return version.major === latestVersion.major && 
               version.minor === undefined && 
               version.patch === undefined;
      });

      if (majorOnlyRelease) {
        core.debug(`Found major-only release: ${majorOnlyRelease.tag_name}`);
        return majorOnlyRelease.tag_name;
      }

      // If no major-only release exists, check for major.minor release
      const majorMinorRelease = releases.find((release: Release) => {
        const version = parseVersion(release.tag_name);
        return version.major === latestVersion.major && 
               version.minor !== undefined && 
               version.patch === undefined;
      });

      if (majorMinorRelease) {
        core.debug(`Found major.minor release: ${majorMinorRelease.tag_name}`);
        return majorMinorRelease.tag_name;
      }

      // If neither exists, use the full version
      core.debug(`Using full version: v${latestVersion.raw}`);
      return `v${latestVersion.raw}`;
    }

    // Case 2: Original version is major.minor (e.g., v3.1)
    else if (currentVersion.patch === undefined) {
      // Try to find a major.minor release of the new version
      const majorMinorRelease = releases.find((release: Release) => {
        const version = parseVersion(release.tag_name);
        return version.major === latestVersion.major && 
               version.minor !== undefined && 
               version.patch === undefined;
      });

      if (majorMinorRelease) {
        core.debug(`Found major.minor release: ${majorMinorRelease.tag_name}`);
        return majorMinorRelease.tag_name;
      }

      // If no major.minor release exists, use the full version
      core.debug(`Using full version: v${latestVersion.raw}`);
      return `v${latestVersion.raw}`;
    }

    // Case 3: Original version is major.minor.patch (e.g., v3.1.2)
    else {
      core.debug(`Using full version: v${latestVersion.raw}`);
      return `v${latestVersion.raw}`;
    }
  } catch (error) {
    core.warning(`Failed to get version for ${actionOwner}/${action.repo}: ${error}`);
    return null;
  }
}

function isNewerVersion(current: string, latest: string): boolean {
  const currentVer = parseVersion(current);
  const latestVer = parseVersion(latest);

  // First compare major versions
  if (latestVer.major > currentVer.major) {
    return true;
  } else if (latestVer.major < currentVer.major) {
    return false;
  }

  // If major versions are equal and we have minor versions to compare
  if (currentVer.minor !== undefined && latestVer.minor !== undefined) {
    if (latestVer.minor > currentVer.minor) {
      return true;
    } else if (latestVer.minor < currentVer.minor) {
      return false;
    }

    // If minor versions are equal and we have patch versions to compare
    if (currentVer.patch !== undefined && latestVer.patch !== undefined) {
      return latestVer.patch > currentVer.patch;
    }
  }

  return false;
}


async function createPullRequest(
  octokit: any,
  action: ActionReference,
  newVersion: string
): Promise<void> {
  const { owner, repo } = github.context.repo;
  const timestamp = Date.now();
  const branchName = `gh-action-upgrader/${action.owner}-${action.repo}-${newVersion}-${timestamp}`;
  
  core.info(`Creating pull request to update ${action.owner}/${action.repo} to ${newVersion}`);
  
  // Get current file content
  const content = fs.readFileSync(action.filePath, 'utf8');
  
  // Update version in content
  const updatedContent = content.replace(
    `${action.owner}/${action.repo}@${action.currentVersion}`,
    `${action.owner}/${action.repo}@${newVersion}`
  );
  
  try {
    // Create new branch
    core.debug('Creating new branch...');
    const { data: ref } = await octokit.git.getRef({
      owner,
      repo,
      ref: 'heads/main'
    });
    
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha
    });
    
    // Update file in new branch
    core.debug('Updating workflow file...');
    const { data: file } = await octokit.repos.getContent({
      owner,
      repo,
      path: action.filePath,
      ref: 'heads/main'
    });
    
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: action.filePath,
      message: `Update ${action.owner}/${action.repo} to ${newVersion}`,
      content: Buffer.from(updatedContent).toString('base64'),
      branch: branchName,
      sha: (file as any).sha
    });
    
    // Create pull request
    core.debug('Creating pull request...');
    await octokit.pulls.create({
      owner,
      repo,
      title: `Update ${action.owner}/${action.repo} to ${newVersion}`,
      head: branchName,
      base: 'main',
      body: `Updates ${action.owner}/${action.repo} from ${action.currentVersion} to ${newVersion}.`
    });
    
    core.info('Pull request created successfully');
  } catch (error) {
    core.warning(`Failed to create PR for ${action.owner}/${action.repo}: ${error}`);
  }
}

run();
