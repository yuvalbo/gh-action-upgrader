import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { compare, validate } from 'compare-versions';

// Dynamically import the `@octokit/rest` library
let Octokit: typeof import('@octokit/rest').Octokit;
(async () => {
  Octokit = (await import('@octokit/rest')).Octokit;
})();

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

async function getLatestVersion(octokit: typeof Octokit, action: ActionReference): Promise<string | null> {
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

function isNewerVersion(current: string,
