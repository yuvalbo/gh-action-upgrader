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
        // Dynamically import the `Octokit` library inside the function to avoid TypeScript issues
        const { Octokit } = await import('@octokit/rest');
        // Get inputs
        const token = core.getInput('github-token', { required: true });
        const octokit = new Octokit({ auth: token });
        const { owner, repo } = github.context.repo;
        core.debug(`in run `);
        // Scan .github directory
        const actionsToUpdate = await scanWorkflowFiles(owner, repo);
        for (const action of actionsToUpdate) {
            const latestVersion = await getLatestVersion(octokit, action);
            if (latestVersion && isNewerVersion(action.currentVersion, latestVersion)) {
                await createPullRequest(octokit, action, latestVersion);
            }
        }
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
        return actions;
    }
    const files = fs.readdirSync(workflowsDir);
    for (const file of files) {
        if (file.endsWith('.yml') || file.endsWith('.yaml')) {
            const filePath = path.join(workflowsDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const workflow = yaml.load(content);
            actions.push(...extractActionsFromWorkflow(workflow, filePath));
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
            if (job.steps) {
                processSteps(job.steps);
            }
        }
    }
    return actions;
}
async function getLatestVersion(octokit, action) {
    var _a;
    try {
        // Try to get latest release first
        const { data: release } = await octokit.repos.getLatestRelease({
            owner: action.owner,
            repo: action.repo
        });
        return release.tag_name;
    }
    catch (_b) {
        try {
            // If no releases, try tags
            const { data: tags } = await octokit.repos.listTags({
                owner: action.owner,
                repo: action.repo,
                per_page: 1
            });
            return ((_a = tags[0]) === null || _a === void 0 ? void 0 : _a.name) || null;
        }
        catch (_c) {
            return null;
        }
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
    try {
        // Returns true if latest is greater than current
        return (0, compare_versions_1.compare)(latest, current, '>');
    }
    catch (error) {
        core.debug(`Error comparing versions: ${error}`);
        return false;
    }
}
async function createPullRequest(octokit, action, newVersion) {
    const { owner, repo } = github.context.repo;
    const branchName = `gh-action-upgrader/${action.owner}-${action.repo}-${newVersion}`;
    // Get current file content
    const content = fs.readFileSync(action.filePath, 'utf8');
    // Update version in content
    const updatedContent = content.replace(`${action.owner}/${action.repo}@${action.currentVersion}`, `${action.owner}/${action.repo}@${newVersion}`);
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
            sha: file.sha
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
    }
    catch (error) {
        core.warning(`Failed to create PR for ${action.owner}/${action.repo}: ${error}`);
    }
}
run();
