"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("js-yaml"));
const compare_versions_1 = require("compare-versions");
async function run() {
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
            }
            else {
                core.info(`${action.owner}/${action.repo} is up to date`);
            }
        }
        core.info(`\nScan complete. Created ${updateCount} update PRs.`);
    }
    catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        }
    }
}
async function scanWorkflowFiles(owner, repo) {
    const actions = [];
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
                const workflow = yaml.load(content);
                const fileActions = extractActionsFromWorkflow(workflow, filePath);
                actions.push(...fileActions);
                core.info(`Found ${fileActions.length} actions in ${file}`);
            }
            catch (error) {
                core.warning(`Error parsing workflow file ${file}: ${error}`);
            }
        }
    }
    return actions;
}
function extractActionsFromWorkflow(workflow, filePath) {
    const actions = [];
    // Recursive function to find actions in steps
    function processSteps(steps) {
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
            if (job.steps) {
                processSteps(job.steps);
            }
        }
    }
    return actions;
}
function parseVersion(version) {
    const cleanVersion = version.replace(/^v/, '');
    const parts = cleanVersion.split('.').map(Number);
    return {
        major: parts[0],
        minor: parts.length > 1 ? parts[1] : undefined,
        patch: parts.length > 2 ? parts[2] : undefined,
        raw: cleanVersion
    };
}
async function getLatestVersion(octokit, action) {
    const actionOwner = action.isGitHubAction ? 'actions' : action.owner;
    core.debug(`Fetching latest version for ${actionOwner}/${action.repo}`);
    try {
        // Get all tags
        const { data: tags } = await octokit.repos.listTags({
            owner: actionOwner,
            repo: action.repo,
            per_page: 100
        });
        // Parse current version
        const currentVersion = parseVersion(action.currentVersion);
        // Get all valid versions from tags
        const allVersions = tags
            .map((tags) => parseVersion(tags.name))
            .filter((v) => (0, compare_versions_1.validate)(v.raw));
        if (allVersions.length === 0) {
            return null;
        }
        core.debug(`Found ${allVersions.length} versions for ${actionOwner}/${action.repo}`);
        // Sort versions by major, minor, patch
        allVersions.sort((a, b) => {
            if (a.major !== b.major)
                return b.major - a.major;
            if (a.minor !== undefined && b.minor !== undefined) {
                if (a.minor !== b.minor)
                    return b.minor - a.minor;
            }
            if (a.patch !== undefined && b.patch !== undefined) {
                return b.patch - a.patch;
            }
            return 0;
        });
        // Get latest full version
        const latestVersion = allVersions[0];
        core.debug(`Latest version of ${actionOwner}/${action.repo} is ${latestVersion.raw}`);
        core.debug(`Current version format: ${currentVersion.minor === undefined ? 'major' :
            currentVersion.patch === undefined ? 'major.minor' : 'major.minor.patch'}`);
        // If no newer major version exists, no upgrade needed
        if (latestVersion.major <= currentVersion.major && currentVersion.minor === undefined) {
            return null;
        }
        // Case 1: Original version is major only (e.g., v3)
        if (currentVersion.minor === undefined) {
            // First try to find a major-only tags of the new version ******
            const majorOnlyTag = tags.find((tag) => {
                const version = parseVersion(tag.name);
                return version.major === latestVersion.major &&
                    version.minor === undefined &&
                    version.patch === undefined;
            });
            if (majorOnlyTag) {
                core.debug(`Found major-only tag: ${majorOnlyTag.name}`);
                return majorOnlyTag.name;
            }
            // If no major-only tag exists, check for major.minor tag
            const majorMinorTag = tags.find((tag) => {
                const version = parseVersion(tag.name);
                return version.major === latestVersion.major &&
                    version.minor !== undefined &&
                    version.patch === undefined;
            });
            if (majorMinorTag) {
                core.debug(`Found major.minor tag: ${majorMinorTag.name}`);
                return majorMinorTag.name;
            }
            // If neither exists, use the full version
            core.debug(`Using full version: v${latestVersion.raw}`);
            return `v${latestVersion.raw}`;
        }
        // Case 2: Original version is major.minor (e.g., v3.1)
        else if (currentVersion.patch === undefined) {
            // Try to find a major.minor tag of the new version
            const majorMinorTag = tags.find((tag) => {
                const version = parseVersion(tag.name);
                return version.major === latestVersion.major &&
                    version.minor !== undefined &&
                    version.patch === undefined;
            });
            if (majorMinorTag) {
                core.debug(`Found major.minor tag: ${majorMinorTag.name}`);
                return majorMinorTag.name;
            }
            // If no major.minor tag exists, use the full version
            core.debug(`Using full version: v${latestVersion.raw}`);
            return `v${latestVersion.raw}`;
        }
        // Case 3: Original version is major.minor.patch (e.g., v3.1.2)
        else {
            core.debug(`Using full version: v${latestVersion.raw}`);
            return `v${latestVersion.raw}`;
        }
    }
    catch (error) {
        core.warning(`Failed to get version for ${actionOwner}/${action.repo}: ${error}`);
        return null;
    }
}
function isNewerVersion(current, latest) {
    const currentVer = parseVersion(current);
    const latestVer = parseVersion(latest);
    // First compare major versions
    if (latestVer.major > currentVer.major) {
        return true;
    }
    else if (latestVer.major < currentVer.major) {
        return false;
    }
    // If major versions are equal and we have minor versions to compare
    if (currentVer.minor !== undefined && latestVer.minor !== undefined) {
        if (latestVer.minor > currentVer.minor) {
            return true;
        }
        else if (latestVer.minor < currentVer.minor) {
            return false;
        }
        // If minor versions are equal and we have patch versions to compare
        if (currentVer.patch !== undefined && latestVer.patch !== undefined) {
            return latestVer.patch > currentVer.patch;
        }
    }
    return false;
}
async function createPullRequest(octokit, action, newVersion) {
    const { owner, repo } = github.context.repo;
    const timestamp = Date.now();
    const branchName = `gh-action-upgrader/${action.owner}-${action.repo}-${newVersion}-${timestamp}`;
    const token = core.getInput('github-token');
    const headers = {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
    };
    core.info(`Creating pull request to update ${action.owner}/${action.repo} to ${newVersion}`);
    // Get current file content
    const content = fs.readFileSync(action.filePath, 'utf8');
    // Update version in content
    const updatedContent = content.replace(`${action.owner}/${action.repo}@${action.currentVersion}`, `${action.owner}/${action.repo}@${newVersion}`);
    const baseBranch = core.getInput('base-branch', { required: true });
    core.info(`Using ${baseBranch} as base branch`);
    try {
        // Get the base branch reference
        let refUrl = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`;
        const baseRefResponse = await fetch(refUrl, { headers });
        if (!baseRefResponse.ok) {
            throw new Error(`Failed to get base branch reference: ${refUrl} response: ${await baseRefResponse.text()}`);
        }
        const baseRef = await baseRefResponse.json();
        const baseSha = baseRef.object.sha;
        // Create new branch
        core.debug('Creating new branch...');
        const createRefResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                ref: `refs/heads/${branchName}`,
                sha: baseSha
            })
        });
        if (!createRefResponse.ok) {
            throw new Error(`Failed to create new branch: ${await createRefResponse.text()}`);
        }
        // Get the current file content and sha
        const fileContentResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${action.filePath}?ref=${baseBranch}`, { headers });
        if (!fileContentResponse.ok) {
            throw new Error(`Failed to get file content: ${await fileContentResponse.text()}`);
        }
        const fileContent = await fileContentResponse.json();
        // Update file in new branch
        core.debug('Updating workflow file...');
        const updateFileResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${action.filePath}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({
                message: `Update ${action.owner}/${action.repo} to ${newVersion}`,
                content: Buffer.from(updatedContent).toString('base64'),
                sha: fileContent.sha,
                branch: branchName
            })
        });
        if (!updateFileResponse.ok) {
            throw new Error(`Failed to update file: ${await updateFileResponse.text()}`);
        }
        // Create pull request
        core.debug('Creating pull request...');
        const createPrResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                title: `Update ${action.owner}/${action.repo} to ${newVersion}`,
                head: branchName,
                base: baseBranch,
                body: `Updates ${action.owner}/${action.repo} from ${action.currentVersion} to ${newVersion}.`
            })
        });
        if (!createPrResponse.ok) {
            throw new Error(`Failed to create PR: ${await createPrResponse.text()}`);
        }
        const pullRequest = await createPrResponse.json();
        core.info(`Pull request #${pullRequest.number} created successfully`);
    }
    catch (error) {
        if (error instanceof Error) {
            core.error(`Failed to create PR: ${error.message}`);
            throw error;
        }
        else {
            core.error('Failed to create PR due to an unknown error');
            throw new Error('Unknown error creating PR');
        }
    }
}
run();
