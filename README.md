# fs-based-agent

A CLI tool for managing fs-based agents.

## Usage

```bash
npx fs-based-agent
```

## Configuration

The configuration is stored in the `config.json` file.

## Development

```bash
npm install

# run demo agent with config file
npm run start -- -c config-sample/demo.agentConfig.json

# run demo agent with json string
npm run start -- -j '{"agentName": "demo", "params": {"modelName": "gpt-4o-mini"}}'
```

