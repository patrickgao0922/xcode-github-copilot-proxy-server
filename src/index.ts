import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { CopilotClient, approveAll } from '@github/copilot-sdk';

import fs from 'fs';
import path from 'path';

dotenv.config();

let config = { 
    githubToken: '',
    logRequestBody: false,
    logResponseBody: false,
    port: 23337
};
try {
    const configPath = path.resolve(process.cwd(), 'config.json');
    if (fs.existsSync(configPath)) {
        config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
    }
} catch (e) {
    console.error('Error reading config.json:', e);
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || config.port || 23337;
const LOG_FILE_PATH = path.resolve(process.cwd(), 'proxy.log');

function logToFileAndConsole(title: string, content: any) {
    const timestamp = new Date().toISOString();
    const formattedContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    const fileEntry = `\n[${timestamp}] ----- ${title} -----\n${formattedContent}\n-------------------------\n`;
    
    console.log(`----- ${title} -----`);
    if (typeof content === 'string') {
        console.log(content);
    } else {
        console.dir(content, { depth: null, colors: true });
    }
    console.log('-------------------------');

    try {
        fs.appendFileSync(LOG_FILE_PATH, fileEntry, 'utf8');
    } catch (e) {
        console.error('Failed to write to log file:', e);
    }
}

// Initialize the GitHub Copilot API Client using Enterprise Authentication
// Assumes you have an environment variable GITHUB_COPILOT_API_KEY or use default oauth for Enterprise
const copilotClient = new CopilotClient({
    githubToken: config.githubToken || process.env.GITHUB_COPILOT_ENTERPRISE_TOKEN || process.env.GITHUB_COPILOT_API_KEY,
    autoStart: true,
    logLevel: 'debug'
});

// We need to start the client before it handles requests
let clientReady = false;
copilotClient.start().then(async () => {
    clientReady = true;
    console.log('GitHub Copilot Node JS SDK Client started successfully.');
    
    try {
        const authStatus = await copilotClient.getAuthStatus();
        console.log(`[Copilot Auth] Status: ${authStatus.isAuthenticated ? 'Authenticated' : 'Not Authenticated'}`);
        if (authStatus.statusMessage) {
            console.log(`[Copilot Auth] Message: ${authStatus.statusMessage}`);
        }
        if (authStatus.login) {
            console.log(`[Copilot Auth] User: ${authStatus.login}`);
        }
        if (authStatus.authType) {
            console.log(`[Copilot Auth] Type: ${authStatus.authType}`);
        }
    } catch (e) {
        console.error('Failed to get auth status:', e);
    }
}).catch(err => {
    console.error('Failed to start GitHub Copilot SDK Client:', err);
});

// Map standard /v1/models endpoint to Xcode Copilot config
app.get('/v1/models', async (req: Request, res: Response): Promise<any> => {
    if (!clientReady) {
        return res.status(503).json({ error: 'Copilot client warming up' });
    }
    
    try {
        const models = await copilotClient.listModels();
        const apiModels = models.map(m => ({
            id: m.id || m.name || (m as any), 
            object: "model",
            created: Date.now(),
            owned_by: "github"
        }));

        // Return according to standard OpenAI schema
        res.json({
            object: "list",
            data: apiModels
        });
    } catch (err: any) {
        console.error("Error listing models:", err);
        // Fallback model representation
        res.json({
            object: "list",
            data: [{
                id: "copilot-chat",
                object: "model",
                created: Date.now(),
                owned_by: "github"
            }]
        });
    }
});

// Standard completion endpoint proxy for Xcode
app.post('/v1/chat/completions', async (req: Request, res: Response): Promise<any> => {
    if (!clientReady) {
        return res.status(503).json({ error: 'Copilot client warming up' });
    }

    const { messages, model = "gpt-4", stream } = req.body;
    
    try {
        console.log(`Received request for model ${model} with ${messages?.length || 0} messages`);
        
        if (config.logRequestBody) {
            logToFileAndConsole('REQUEST BODY', req.body);
        }

        // Extract the latest query
        if (!messages || messages.length === 0) {
            return res.status(400).json({ error: 'No messages provided' });
        }

        // Setup Copilot Session
        const session = await copilotClient.createSession({
            model: String(model),
            onPermissionRequest: approveAll
        });

        // Safely extract string content from messages (Xcode 26.3 might send arrays of objects instead of pure text strings)
        const prompt = messages.map((m: any) => {
            let contentString = m.content;
            if (Array.isArray(m.content)) {
                contentString = m.content.map((part: any) => {
                    if (typeof part === 'string') return part;
                    if (part.type === 'text') return part.text || '';
                    if (part.type === 'image_url') return '[Image]';
                    return JSON.stringify(part);
                }).join(' ');
            } else if (typeof m.content === 'object' && m.content !== null) {
                contentString = JSON.stringify(m.content);
            }
            return `${m.role}: ${contentString}`;
        }).join('\n\n');
        
        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            
            let responseText = '';
            
            session.on('assistant.message', (event) => {
                if (config.logResponseBody) {
                    responseText += event.data.content;
                }
                // Return token deltas
                res.write(`data: ${JSON.stringify({
                    id: `chatcmpl-${session.sessionId}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [{
                        index: 0,
                        delta: { content: event.data.content },
                        finish_reason: null
                    }]
                })}\n\n`);
            });

            session.on('session.idle', async () => {                
                if (config.logResponseBody) {
                    logToFileAndConsole('RESPONSE BODY', responseText);
                }                
                res.write(`data: ${JSON.stringify({
                    id: `chatcmpl-${session.sessionId}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [{
                        index: 0,
                        delta: {},
                        finish_reason: "stop"
                    }]
                })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
                await session.destroy();
            });

            await session.send({ prompt });
        } else {
            // Block mode
            let fullResponse = '';
            session.on('assistant.message', (event) => {
                fullResponse += event.data.content;
            });
            
            await new Promise<void>((resolve) => {
                session.on('session.idle', () => resolve());
                session.send({ prompt });
            });
            
            if (config.logResponseBody) {
                logToFileAndConsole('RESPONSE BODY', fullResponse);
            }
            
            res.json({
                id: `chatcmpl-${session.sessionId}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: fullResponse
                    },
                    finish_reason: "stop"
                }],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: fullResponse.length,
                    total_tokens: fullResponse.length
                }
            });
            
            await session.destroy();
        }

    } catch (err: any) {
        console.error("Error in completion:", err);
        res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
});

// Handle graceful shutdown
const shutdown = async () => {
    console.log("Shutting down proxy...");
    await copilotClient.stop();
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.listen(PORT, () => {
    console.log(`GitHub Copilot Xcode Proxy running on port ${PORT}`);
});
