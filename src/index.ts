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

function parseVersion(version: string): { major: number; minor?: number; patch?: number; raw: string } {
  const match = version.match(/^v(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) throw new Error(`Invalid version format: ${version}`);
  return {
    major: parseInt(match[1], 10),
    minor: match[2] ? parseInt(match[2], 10) : undefined,
    patch: match[3] ? parseInt(match[3], 10) : undefined,
    raw: version,
  };
}

function determineTargetVersion(currentVersion: string, releases: Release[]): string | null {
  const parsedCurrent = parseVersion(currentVersion);

  // Sort releases by version (descending)
  const sortedReleases = releases
    .map((release) => parseVersion(release.tag_name))
    .filter((v) => validate(v.raw))
    .sort((a, b) => compare(b.raw, a.raw));

  for (const release of sortedReleases) {
    // Major-only case (e.g., v3)
    if (parsedCurrent.minor === undefined) {
      if (release.major > parsedCurrent.major) {
        // Look for a major-only release (e.g., v4)
        if (!release.minor && !release.patch) {
          return `v${release.major}`;
        }
        // Fallback to latest full release (e.g., v4.x.y)
        return `v${release.raw}`;
      }
    }
    // Major.Minor case (e.g., v3.1)
    else if (parsedCurrent.patch === undefined) {
      if (release.major === parsedCurrent.major && release.minor > parsedCurrent.minor) {
        // Look for a major.minor release (e.g., v3.2)
        if (!release.patch) {
          return `v${release.major}.${release.minor}`;
        }
        // Fallback to latest full release (e.g., v3.2.x)
        return `v${release.raw}`;
      }
    }
    // Major.Minor.Patch case (e.g., v3.1.2)
    else {
      if (
        release.major === parsedCurrent.major &&
        release.minor === parsedCurrent.minor &&
        release.patch > parsedCurrent.patch
      ) {
        return `v${release.raw}`;
      }
    }
  }

  // No upgrade available
  return null;
}


async function getLatestVersion(currentVersion: string, releases: Release[]): Promise<string | null> {
  // Fetch the target version using determineTargetVersion
  return  determineTargetVersion(currentVersion, releases);
}


function isNewerVersion(currentVersion: string, newVersion: string): boolean {
  const current = parseVersion(currentVersion);
  const latest = parseVersion(newVersion);

  if (latest.major > current.major) return true;
  if (latest.major === current.major) {
    if ((latest.minor ?? 0) > (current.minor ?? 0)) return true;
    if ((latest.minor ?? 0) === (current.minor ?? 0)) {
      return (latest.patch ?? 0) > (current.patch ?? 0);
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
