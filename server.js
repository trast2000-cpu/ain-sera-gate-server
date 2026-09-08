const http = require('http');
const fs = require('fs');
const path = require('path');
const { Redis } = require('@upstash/redis');

if (process.platform === 'win32') {
    try {
        require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
    } catch (e) {}
}

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'ain-sera-gate_v7');
const REDIS_KEY = 'ain_sera_database_records';

let redis;
try {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        redis = Redis.fromEnv();
    }
} catch (e) {}

let recordWriteQueue = Promise.resolve();
function enqueueRecordWrite(task) {
    const operation = recordWriteQueue.then(task, task);
    recordWriteQueue = operation.catch(() => {});
    return operation;
}

function readDataDirectly() {
    if (redis) {
        return redis.get(REDIS_KEY).then(data => {
            if (!data) return JSON.stringify({ mahdar_index: [] });
            return typeof data === 'string' ? data : JSON.stringify(data);
        }).catch(() => JSON.stringify({ mahdar_index: [] }));
    }
    return new Promise(resolve => {
        fs.readFile(DATA_FILE, 'utf8', (err, data) => {
            resolve(data || JSON.stringify({ mahdar_index: [] }));
        });
    });
}

function safeReadData() {
    return enqueueRecordWrite(() => readDataDirectly());
}

function safeWriteData(content) {
    if (redis) {
        const parsed = typeof content === 'string' ? JSON.parse(content) : content;
        return redis.set(REDIS_KEY, JSON.stringify(parsed));
    }
    const tmpFile = DATA_FILE + '.tmp';
    return new Promise((resolve, reject) => {
        fs.writeFile(tmpFile, content, 'utf8', err => {
            if (err) return reject(err);
            fs.rename(tmpFile, DATA_FILE, err2 => {
                if (err2) return reject(err2);
                resolve();
            });
        });
    });
}

if (!redis && !fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ mahdar_index: [] }));
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Record-Key, X-Delete-Record');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    

    // 1. مسار جلب البيانات
    if (req.url === '/api/data' && req.method === 'GET') {
        safeReadData().then(data => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(data);
        });
        return;
    }

    // 2. مسار حفظ البيانات
    if (req.url === '/api/data' && req.method === 'POST') {
        const recordKey = req.headers['x-record-key'] ? decodeURIComponent(req.headers['x-record-key']) : null;
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        
        req.on('end', () => {
            if (recordKey) {
                let incoming;
                try {
                    incoming = JSON.parse(body);
                } catch (e) {
                    res.writeHead(400);
                    return res.end('Invalid JSON');
                }

                enqueueRecordWrite(() => readDataDirectly().then(currentRaw => {
                    let current;
                    try {
                        current = currentRaw ? JSON.parse(currentRaw) : {};
                        if (Array.isArray(current) || typeof current !== 'object' || current === null) {
                            current = { mahdar_index: [] };
                        }
                    } catch (e) {
                        current = { mahdar_index: [] };
                    }

                    if (req.headers['x-delete-record'] === 'true') {
                        delete current[recordKey];
                    } else if (Object.prototype.hasOwnProperty.call(incoming, recordKey)) {
                        current[recordKey] = Object.assign({}, current[recordKey] || {}, incoming[recordKey]);
                    }

                    if (recordKey.indexOf('mahdar_') === 0) {
                        let index = Array.isArray(current.mahdar_index) ? current.mahdar_index : [];
                        const existingPos = index.indexOf(recordKey);
                        if (req.headers['x-delete-record'] === 'true') {
                            if (existingPos !== -1) index.splice(existingPos, 1);
                        } else if (existingPos === -1) {
                            index.push(recordKey);
                        }
                        current.mahdar_index = index;
                    } else if (!Array.isArray(current.mahdar_index)) {
                        current.mahdar_index = [];
                    }

                    return safeWriteData(JSON.stringify(current, null, 4)).then(() => {
                        res.writeHead(200, { 'Content-Type': 'text/plain' });
                        res.end('Saved');
                    }).catch(err => {
                        res.writeHead(500);
                        res.end('Error');
                    });
                }));
                return;
            }

            enqueueRecordWrite(() => safeWriteData(body)).then(() => {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Saved');
            }).catch(err => {
                res.writeHead(500);
                res.end('Error');
            });
        });
        return;
    }

    // 3. عرض ملفات البوابة
    let filePath = '';
    if (req.url === '/') {
        filePath = path.join(PUBLIC_DIR, 'بوابه_نيابه_مرور_عين_الصيره.html');
    } else {
        filePath = path.join(PUBLIC_DIR, decodeURI(req.url));
    }
    
    let extname = String(path.extname(filePath)).toLowerCase();
    let mimeTypes = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
        '.pdf': 'application/pdf', '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
    let contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('File Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running! Port: ${PORT}`);
});
