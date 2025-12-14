import 'dotenv/config';
import { runRepoWikiAgent } from './repoWikiAgent.js'
import { spawnSync } from 'child_process';

if (process.env.REPO_URL && process.env.BRANCH) {
    runRepoWikiAgent({
        repoUrl: process.env.REPO_URL,
        branch: process.env.BRANCH,
    }).then((result) => {
        // Execute npx mdts result.wikiOutputPath using node
        const { wikiOutputPath } = result;
        const command = `npx mdts ${wikiOutputPath}`;
        const child = spawnSync(command, { shell: true });
        console.log(child.stdout.toString());
    })
} else {
    console.log('Please set REPO_URL and BRANCH environment variables');
}
