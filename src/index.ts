import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Octokit } from '@octokit/rest';
import { compare, validate } from 'compare-versions';

interface ActionReference {
  owner: string;
  repo: string;
  currentVersion: string;
  filePath: string;
}

async function run(): Promise<void> {
  try {
    // Get inputs
    const token = core.getInput('github-token', { required: true });
    const octokit = new Octokit({ auth: token });
    const { owner, repo } = github.context.repo;

    // Scan .github directory
    const actionsToUpdate = await scanWorkflowFiles(owner, repo);
    
    for (const action of actionsToUpdate) {
      const latestVersion = await getLatestVersion(octokit, action);
      
      if (latestVersion && isNewerVersion(action.currentVersion, latestVersion)) {
        await createPullRequest(octokit, action, latestVersion);
      }
    }
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
    return actions;
  }

  const files = fs.readdirSync(workflowsDir);
  
  for (const file of files) {
    if (file.endsWith('.yml') || file.endsWith('.yaml')) {
      const filePath = path.join(workflowsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const workflow = yaml.load(content) as any;

      actions.push(...extractActionsFromWorkflow(workflow, filePath));
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
        
        // Only process third-party actions (not local or GitHub-owned)
        if (owner && repo && owner !== 'actions' && !step.uses.startsWith('./')) {
          actions.push({
            owner,
            repo,
            currentVersion: version,
            filePath
          });
        }
      }
    }
  }

  // Process all jobs
  if (workflow.jobs) {
    for (const job of Object.values(workflow.jobs)) {
      if ((job as any).steps) {
        processSteps((job as any).steps);
      }
    }
  }

  return actions;
}

async function getLatestVersion(octokit: Octokit, action: ActionReference): Promise<string | null> {
  try {
    // Try to get latest release first
    const { data: release } = await octokit.repos.getLatestRelease({
      owner: action.owner,
      repo: action.repo
    });
    return release.tag_name;
  } catch {
    try {
      // If no releases, try tags
      const { data: tags } = await octokit.repos.listTags({
        owner: action.owner,
        repo: action.repo,
        per_page: 1
      });
      return tags[0]?.name || null;
    } catch {
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
  
  try {
    // Returns true if latest is greater than current
    return compare(latest, current, '>');
  } catch (error) {
    core.debug(`Error comparing versions: ${error}`);
    return false;
  }
}

async function createPullRequest(
  octokit: Octokit,
  action: ActionReference,
  newVersion: string
): Promise<void> {
  const { owner, repo } = github.context.repo;
  const branchName = `action-update/${action.owner}-${action.repo}-${newVersion}`;
  
  // Get current file content
  const content = fs.readFileSync(action.filePath, 'utf8');
  
  // Update version in content
  const updatedContent = content.replace(
    `${action.owner}/${action.repo}@${action.currentVersion}`,
    `${action.owner}/${action.repo}@${newVersion}`
  );
  
  try {
    // Create new branch
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
    await octokit.pulls.create({
      owner,
      repo,
      title: `Update ${action.owner}/${action.repo} to ${newVersion}`,
      head: branchName,
      base: 'main',
      body: `Updates ${action.owner}/${action.repo} from ${action.currentVersion} to ${newVersion}.`
    });
  } catch (error) {
    core.warning(`Failed to create PR for ${action.owner}/${action.repo}: ${error}`);
  }
}

run();
