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
async function getLatestVersion(octokit, action) {
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
                .map((release) => release.tag_name.replace(/^v/, ''))
                .filter((version) => (0, compare_versions_1.validate)(version))
                .sort((a, b) => (0, compare_versions_1.compare)(b, a, '>') ? 1 : -1);
            if (versions.length === 0) {
                return null;
            }
            const latestFullVersion = versions[0];
            const majorVersion = latestFullVersion.split('.')[0];
            // If original version was major only (v3)
            if (versionParts === 1) {
                // First try to find a major-only version release (v4)
                const majorOnlyRelease = releases.find((release) => release.tag_name.replace(/^v/, '') === majorVersion ||
                    release.tag_name === `v${majorVersion}`);
                if (majorOnlyRelease) {
                    return majorOnlyRelease.tag_name;
                }
                // Then try to find major.minor version (v4.1)
                const majorMinorVersion = versions.find((version) => {
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
                const majorMinorVersion = versions.find((version) => {
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
                .map((tag) => tag.name.replace(/^v/, ''))
                .filter((version) => (0, compare_versions_1.validate)(version))
                .sort((a, b) => (0, compare_versions_1.compare)(b, a, '>') ? 1 : -1);
            if (versions.length === 0) {
                return null;
            }
            const latestVersion = versions[0];
            const majorVersion = latestVersion.split('.')[0];
            // Apply the same version format logic as with releases
            if (versionParts === 1) {
                const majorOnlyTag = tags.find((tag) => tag.name.replace(/^v/, '') === majorVersion ||
                    tag.name === `v${majorVersion}`);
                if (majorOnlyTag) {
                    return majorOnlyTag.name;
                }
                const majorMinorVersion = versions.find((version) => {
                    const parts = version.split('.');
                    return parts.length === 2 && parts[0] === majorVersion;
                });
                if (majorMinorVersion) {
                    return `v${majorMinorVersion}`;
                }
                return `v${latestVersion}`;
            }
            else if (versionParts === 2) {
                const majorMinorVersion = versions.find((version) => {
                    const parts = version.split('.');
                    return parts.length === 2;
                });
                if (majorMinorVersion) {
                    return `v${majorMinorVersion}`;
                }
                const parts = latestVersion.split('.');
                return `v${parts[0]}.${parts[1]}`;
            }
            else {
                return `v${latestVersion}`;
            }
        }
        core.debug('No tags found');
        return null;
    }
    catch (error) {
        core.warning(`Failed to get version for ${actionOwner}/${action.repo}: ${error}`);
        return null;
    }
}
function isNewerVersion(current, latest) {
    // Remove 'v' prefix if present
    current = current.replace(/^v/, '');
    latest = latest.replace(/^v/, '');
    // Validate versions
    if (!(0, compare_versions_1.validate)(current) || !(0, compare_versions_1.validate)(latest)) {
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
        }
        else if (currentParts.length === 2) {
            // Compare major and minor versions
            return (latestParts[0] > currentParts[0] ||
                (latestParts[0] === currentParts[0] && latestParts[1] > currentParts[1]));
        }
        else {
            // Compare full versions
            return (latestParts[0] > currentParts[0] ||
                (latestParts[0] === currentParts[0] && latestParts[1] > currentParts[1]) ||
                (latestParts[0] === currentParts[0] && latestParts[1] === currentParts[1] && latestParts[2] > currentParts[2]));
        }
    }
    catch (error) {
        core.warning(`Error comparing versions: ${error}`);
        return false;
    }
}
async function createPullRequest(octokit, action, newVersion) {
    const { owner, repo } = github.context.repo;
    const timestamp = Date.now();
    const branchName = `gh-action-upgrader/${action.owner}-${action.repo}-${newVersion}-${timestamp}`;
    core.info(`Creating pull request to update ${action.owner}/${action.repo} to ${newVersion}`);
    // Get current file content
    const content = fs.readFileSync(action.filePath, 'utf8');
    // Update version in content
    const updatedContent = content.replace(`${action.owner}/${action.repo}@${action.currentVersion}`, `${action.owner}/${action.repo}@${newVersion}`);
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
            sha: file.sha
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
    }
    catch (error) {
        core.warning(`Failed to create PR for ${action.owner}/${action.repo}: ${error}`);
    }
}
run();
