import { program } from "commander";
import * as fs from "fs";
import type { AgentConfig } from "./core/CoreDef.js";
import agentMap from "./agents/agentMap.js";

program
    .option("-c, --config <path>", "配置文件路径")
    .option("-j, --json <jsonString>", "配置信息的 JSON 字符串")
    .parse(process.argv);

const options = program.opts();

// Check for mutually exclusive parameters
if (options.config && options.json) {
    console.error("错误: --config 和 --json 参数不能同时使用");
    process.exit(1);
}

if (!options.config && !options.json) {
    console.error("错误: 请提供 --config 或 --json 参数");
    process.exit(1);
}

try {
    let config!: AgentConfig<any>;

    if (options.config) {
        const fileContent = fs.readFileSync(options.config, "utf-8");
        config = JSON.parse(fileContent) as AgentConfig<any>;
    } else if (options.json) {
        config = JSON.parse(options.json) as AgentConfig<any>;
    }

    const runAgentFunction =
        agentMap[config.agentName as keyof typeof agentMap];
    if (!runAgentFunction) {
        console.error(`错误: 未找到 agentName: ${config.agentName}`);
        process.exit(1);
    } else {
        const result = await runAgentFunction(config.params);
        console.log(result);
    }
} catch (error) {
    if (error instanceof Error) {
        console.error(`错误: ${error.message}`);
    } else {
        console.error("发生未知错误");
    }
    process.exit(1);
}
