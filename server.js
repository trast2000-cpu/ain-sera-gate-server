const http = require('http');
const fs = require('fs');
const path = require('path');
const { Redis } = require('@upstash/redis');

// إصلاح ترميز الشاشة على ويندوز
if (process.platform === 'win32') {
    try {
        require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
    } catch (e) {}
}

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'ain-sera-gate_v7');
const REDIS_KEY = 'ain_sera_database_records';

// إعداد الاتصال بقاعدة البيانات السحابية Upstash
let redis;
try {
    redis = Redis.fromEnv();
} catch (err) {
    console.log('[WARN] Upstash environment variables not found. Running in fallback mode.');
}

// دالة مساعدة لقراءة البيانات من السحابة
async function getCloudData() {
    if (!redis) return { mahdar_index: [] };
    try {
        const data = await redis.get(REDIS_KEY);
        if (!data) return { mahdar_index: [] };
        return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
        console.error('[ERROR] Failed to read from Upstash:', e);
        return { mahdar_index: [] };
    }
}

// دالة مساعدة لحفظ البيانات في السحابة
async function saveCloudData(data) {
    if (!redis) return;
    try {
        await redis.set(REDIS_KEY, JSON.stringify(data));
    } catch (e) {
        console.error('[ERROR] Failed to write to Upstash:', e);
        throw e;
    }
}

// منع فقدان التحديثات عند تزامن الطلبات
let recordWriteQueue = Promise.resolve();
function enqueueRecordWrite(task) {
    const operation = recordWriteQueue.then(task, task);
    recordWriteQueue = operation.catch(() => {});
    return operation;
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Record-Key, X-Delete-Record');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    // 1. مسار جلب البيانات (قراءة من السحابة)
    if (req.url === '/api/data' && req.method === 'GET') {
        try {
            const current = await getCloudData();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(current));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Database read error' }));
        }
    }

    // 2. مسار حفظ البيانات (كتابة ومزامنة سحابية)
    if (req.url === '/api/data' && req.method === 'POST') {
        console.log('[INFO] Server received a save request from the browser...');
        const recordKey = req.headers['x-record-key'] ? decodeURIComponent(req.headers['x-record-key']) : null;
        let body = '';
        
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            if (recordKey) {
                let incoming;
                try {
                    incoming = JSON.parse(body);
                } catch (e) {
                    console.log('[ERROR] Invalid JSON received in save request:', e);
                    res.writeHead(400);
                    return res.end('Invalid JSON');
                }

                enqueueRecordWrite(async () => {
                    try {
                        let current = await getCloudData();
                        if (Array.isArray(current) || typeof current !== 'object' || current === null) {
                            current = { mahdar_index: [] };
                        }

                        // حذف أو دمج سجل المحضر
                        if (req.headers['x-delete-record'] === 'true') {
                            delete current[recordKey];
                        } else if (Object.prototype.hasOwnProperty.call(incoming, recordKey)) {
                            current[recordKey] = Object.assign({}, current[recordKey] || {}, incoming[recordKey]);
                        }

                        // تحديث الفهرس
                        if (recordKey.indexOf('mahdar_') === 0) {
                            let index = Array.isArray(current.mahdar_index) ? current.mahdar_index : [];
                            const existingPos = index.indexOf(recordKey);
                            if (existingPos !== -1) index.splice(existingPos, 1);
                            if (req.headers['x-delete-record'] !== 'true') index.push(recordKey);
                            current.mahdar_index = index;
                        } else if (!Array.isArray(current.mahdar_index)) {
                            current.mahdar_index = [];
                        }

                        // الحفظ الدائم في قاعدة البيانات
                        await saveCloudData(current);
                        console.log(`[SUCCESS] Record [${recordKey}] saved to Cloud Database!`);
                        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                        res.end('Saved');
                    } catch (err) {
                        console.log('[ERROR] Writing to cloud failed:', err);
                        res.writeHead(500);
                        res.end('Error');
                    }
                });
                return;
            }

            // عملية عامة (استبدال كلي)
            try {
                const parsedBody = JSON.parse(body);
                await saveCloudData(parsedBody);
                console.log('[SUCCESS] Full database overwritten in Cloud Database!');
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Saved');
            } catch (err) {
                console.log('[ERROR] Writing full body to cloud failed:', err);
                res.writeHead(500);
                res.end('Error');
            }
        });
        return;
    }

    // 3. عرض ملفات البوابة الثابتة (HTML, CSS, JS, Images)
    let filePath = '';
    if (req.url === '/') {
        filePath = path.join(PUBLIC_DIR, 'بوابه_نيابه_مرور_عين_الصيره.html');
    } else {
        filePath = path.join(PUBLIC_DIR, decodeURI(req.url));
    }
    
    let extname = String(path.extname(filePath)).toLowerCase();
    let mimeTypes = {
        '.html': 'text/html; charset=utf-8', 
        '.js': 'text/javascript; charset=utf-8', 
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8', 
        '.png': 'image/png', 
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', 
        '.gif': 'image/gif', 
        '.webp': 'image/webp', 
        '.svg': 'image/svg+xml',
        '.woff': 'font/woff', 
        '.woff2': 'font/woff2', 
        '.ttf': 'font/ttf',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
    let contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('File Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('Server is running with Cloud Database support!');
    console.log(`Port: ${PORT}`);
});
