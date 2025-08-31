import express from 'express';
import fs from 'fs';
import pino from 'pino';
import NodeCache from 'node-cache';
import {
    useMultiFileAuthState,
    delay,
    Browsers,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    makeWASocket,
} from 'baileys';
import { Mutex } from 'async-mutex';
import config from './config.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import axios from 'axios';
import FormData from 'form-data';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const port = 3000;
let session;

const msgRetryCounterCache = new NodeCache();
const mutex = new Mutex();

app.use(express.static(path.join(__dirname, 'static')));

async function uploadCreds(buffer, filename) {
    const form = new FormData();
    form.append('file', buffer, { filename });
    const response = await axios.post('https://cdn-haki.zone.id/upload', form, {
        headers: form.getHeaders(),
    });
    return response.data;
}

async function connector(Num, res) {
    const sessionDir = './session';
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    session = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' }))
        },
        logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
        browser: Browsers.macOS("Safari"),
        markOnlineOnConnect: true,
        msgRetryCounterCache
    });

    if (!session.authState.creds.registered) {
        await delay(1500);
        Num = Num.replace(/[^0-9]/g, '');
        const code = await session.requestPairingCode(Num);
        if (!res.headersSent) {
            res.send({ code: code?.match(/.{1,4}/g)?.join('-') });
        }
    }

    session.ev.on('creds.update', saveCreds);

    session.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('Connected successfully');
            await delay(7000);
            await session.sendMessage(session.user.id, { text: `${config.MESSAGE}` });

            try {
                const sessionPath = path.join(__dirname, './session', 'creds.json');
                if (fs.existsSync(sessionPath)) {
                    const buffer = fs.readFileSync(sessionPath);
                    const result = await uploadCreds(buffer, 'creds.json');
                    const sessionId = result?.url || result?.file || JSON.stringify(result);
                    await session.sendMessage(session.user.id, {
                        image: { url: "https://files.catbox.moe/bxcqsb.jpg" },
                        caption: sessionId
                    });
                }
            } catch (error) {
                console.error('❌ Upload error:', error);
            } finally {
                const sessionPath = path.join(__dirname, './session');
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                }
            }

        } else if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            reconn(reason);
        }
    });
}

function reconn(reason) {
    if ([DisconnectReason.connectionLost, DisconnectReason.connectionClosed, DisconnectReason.restartRequired].includes(reason)) {
        console.log('Connection lost, reconnecting...');
        connector();
    } else {
        console.log(`Disconnected! reason: ${reason}`);
        session?.end?.();
    }
}

app.get('/pair', async (req, res) => {
    const Num = req.query.code;
    if (!Num) {
        return res.status(418).json({ message: 'Phone number is required' });
    }

    const release = await mutex.acquire();
    try {
        await connector(Num, res);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "fekd up" });
    } finally {
        release();
    }
});

app.listen(port, () => {
    console.log(`Running on PORT:${port}`);
});
