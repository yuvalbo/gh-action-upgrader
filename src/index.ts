import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { compare, validate } from 'compare-versions';

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

async function getLatestVersion(octokit: any, action: ActionReference): Promise<string | null> {
  const actionOwner = action.isGitHubAction ? 'actions' : action.owner;
  core.debug(`Fetching latest version for ${actionOwner}/${action.repo}`);
  
  try {
    // Try to get latest release first
    core.debug('Checking latest release...');
    const { data: release } = await octokit.repos.getLatestRelease({
      owner: actionOwner,
      repo: action.repo
    });
    core.debug(`Found latest release: ${release.tag_name}`);
    return release.tag_name;
  } catch {
    try {
      // If no releases, try tags
      core.debug('No releases found, checking tags...');
      const { data: tags } = await octokit.repos.listTags({
        owner: actionOwner,
        repo: action.repo,
        per_page: 1
      });
      
      if (tags[0]?.name) {
        core.debug(`Found latest tag: ${tags[0].name}`);
        return tags[0].name;
      }
      
      core.debug('No tags found');
      return null;
    } catch (error) {
      core.warning(`Failed to get version for ${actionOwner}/${action.repo}: ${error}`);
      return null;
    }
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

  // Split versions into parts (major.minor.patch)
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  try {
    if (currentParts.length === 1) {
      // Only major version is specified
      core.debug(`Comparing major versions: ${currentParts[0]} vs ${latestParts[0]}`);
      return latestParts[0] > currentParts[0];
    } else if (currentParts.length === 2) {
      // Major and minor versions are specified
      core.debug(`Comparing major.minor versions: ${currentParts.join('.')} vs ${latestParts.join('.')}`);
      return (
        latestParts[0] > currentParts[0] || 
        (latestParts[0] === currentParts[0] && latestParts[1] > currentParts[1])
      );
    } else if (currentParts.length === 3) {
      // Full version is specified
      core.debug(`Comparing full versions: ${currentParts.join('.')} vs ${latestParts.join('.')}`);
      return (
        latestParts[0] > currentParts[0] ||
        (latestParts[0] === currentParts[0] && latestParts[1] > currentParts[1]) ||
        (latestParts[0] === currentParts[0] && latestParts[1] === currentParts[1] && latestParts[2] > currentParts[2])
      );
    }
    return false;
  } catch (error) {
    core.warning(`Error comparing versions: ${error}`);
    return false;
  }
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
