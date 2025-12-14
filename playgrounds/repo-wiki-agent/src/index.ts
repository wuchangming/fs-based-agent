import 'dotenv/config';
import { runRepoWikiAgent } from './repoWikiAgent.js'
import { spawnSync } from 'child_process';

if (process.env.REPO_URL && process.env.BRANCH) {
    runRepoWikiAgent({
        repoUrl: process.env.REPO_URL,
        branch: process.env.BRANCH,
    }).then((result) => {
        // 用 node 执行 npx mdts result.wikiOutputPath
        const { wikiOutputPath } = result;
        const command = `npx mdts ${wikiOutputPath}`;
        const child = spawnSync(command, { shell: true });
        console.log(child.stdout.toString());
    })
} else {
    console.log('Please set REPO_URL and BRANCH environment variables');
}
