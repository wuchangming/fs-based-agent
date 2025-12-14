import 'dotenv/config';
import { runRepoWikiAgent } from './repoWikiAgent.js'


if (process.env.REPO_URL && process.env.BRANCH) {
    runRepoWikiAgent({
        repoUrl: process.env.REPO_URL,
        branch: process.env.BRANCH,
    })
} else {
    console.log('Please set REPO_URL and BRANCH environment variables');
}
