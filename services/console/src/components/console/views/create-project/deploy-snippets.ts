export const API_KEY_PLACEHOLDER = "YOUR_API_KEY";

export function getDeployCommand(projectName: string, apiKey: string) {
    return `npm i evolo && npx evolo deploy --project=${projectName} --source=dist --api-key=${apiKey}`;
}

export function getWorkflowCode(projectName: string, apiKey: string) {
    const deploy = getDeployCommand(projectName, apiKey);

    return `name: Deploy to Evolo

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install & build
        run: |
          npm ci
          npm run build

      - name: Deploy to Evolo
        env:
          EVOLO_API_KEY: \${{ secrets.EVOLO_API_KEY }}
        run: ${deploy.replace(apiKey, "$EVOLO_API_KEY")}
`;
}
