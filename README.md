# Xcode 26.3 + GitHub Copilot Proxy Server (Enterprise)
This is a NodeJS proxy using Express and TypeScript designed to emulate or proxy endpoints to natively integrate Xcode 26.3 with GitHub Copilot Enterprise using standard LLM API footprints.

## Setup
1. `npm install`
2. Create an `.env` file with `GITHUB_COPILOT_ENTERPRISE_TOKEN=<your token>`.
   - Alternatively, you can copy `config.json.example` to `config.json` and set your token there.
   - *(Optional)* To log the request and response payload from Xcode to Copilot, set `"logRequestBody": true` and `"logResponseBody": true` in your `config.json` file.
   - *(Optional)* Set a custom port by modifying `"port": 23337` in your `config.json` file.
3. Start the server via `npm run dev` or `npm start`.

Point Xcode's GitHub Copilot integration settings to `http://localhost:23337/v1` instead of the default.
