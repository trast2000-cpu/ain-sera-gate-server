const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

if (process.platform === 'win32') {
    try { require('child_process').execSync('chcp 65001', { stdio: 'ignore' }); } catch (e) {}
}

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PROFILES_FILE = path.join(__dirname, 'profiles.json');
const PUBLIC_DIR = path.join(__dirname, 'ain-sera-gate_v7');
const REDIS_DATA_KEY = 'ain_sera_database_records';
const REDIS_PROFILES_KEY = 'ain_sera_profiles_records';

// مفتاح ثابت للجلسات السحابية لمنع تسجيل الخروج العشوائي في Vercel
const SECRET_KEY = process.env.SESSION_SECRET || 'niabat_cloud_secure_session_key_2026_x99';

let redis;
try {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        redis = Redis.fromEnv();
    }
} catch (e) {}

// === محرك الرموز المشفرة (Tokens) ===
function toBase64Url(str) {
    return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function toBase64UrlFromBuffer(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function createToken(payload) {
    const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = toBase64Url(JSON.stringify(payload));
    const signature = toBase64UrlFromBuffer(crypto.createHmac('sha256', SECRET_KEY).update(header + '.' + body).digest());
    return header + '.' + body + '.' + signature;
}
function verifyToken(token) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const signature = toBase64UrlFromBuffer(crypto.createHmac('sha256', SECRET_KEY).update(parts[0] + '.' + parts[1]).digest());
    if (signature !== parts[2]) return null;
    try { return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')); }
    catch (e) { return null; }
}

function hashPassword(password) {
    if (!password) return '';
    if (password.length === 64 && /^[0-9a-f]{64}$/i.test(password)) return password;
    return crypto.createHash('sha256').update(password).digest('hex');
}

// === التعامل مع قاعدة البيانات السحابية والمحلية ===
function readDataDirectly() {
    if (redis) {
        return redis.get(REDIS_DATA_KEY).then(data => {
            if (!data) return JSON.stringify({ mahdar_index: [] });
            return typeof data === 'string' ? data : JSON.stringify(data);
        }).catch(() => JSON.stringify({ mahdar_index: [] }));
    }
    return new Promise(resolve => {
        fs.readFile(DATA_FILE, 'utf8', (err, data) => resolve(data || JSON.stringify({ mahdar_index: [] })));
    });
}

function safeWriteData(content) {
    if (redis) {
        const parsed = typeof content === 'string' ? JSON.parse(content) : content;
        return redis.set(REDIS_DATA_KEY, JSON.stringify(parsed));
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

function readProfilesDirectly() {
    if (redis) {
        return redis.get(REDIS_PROFILES_KEY).then(data => {
            if (!data) {
                if (fs.existsSync(PROFILES_FILE)) {
                    return fs.readFileSync(PROFILES_FILE, 'utf8');
                }
                return '{}';
            }
            return typeof data === 'string' ? data : JSON.stringify(data);
        }).catch(() => '{}');
    }
    return new Promise(resolve => {
        fs.readFile(PROFILES_FILE, 'utf8', (err, data) => resolve(data || '{}'));
    });
}

function safeWriteProfiles(content) {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    if (redis) {
        return redis.set(REDIS_PROFILES_KEY, JSON.stringify(parsed));
    }
    return new Promise((resolve, reject) => {
        fs.writeFile(PROFILES_FILE, JSON.stringify(parsed, null, 4), 'utf8', err => {
            if (err) return reject(err);
            resolve();
        });
    });
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Record-Key, X-Delete-Record');

    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    const cookies = req.headers.cookie ? req.headers.cookie.split(';').reduce((acc, c) => {
        const [k, v] = c.trim().split('=');
        acc[k] = v; return acc;
    }, {}) : {};
    const userSession = verifyToken(cookies['niabat_token']);

    // 1. تسجيل الدخول وإصدار الختم
    if (req.url === '/api/auth' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const creds = JSON.parse(body);
                const rawProfiles = await readProfilesDirectly();
                const profilesData = JSON.parse(rawProfiles || '{}');
                let isValid = false;
                let payload = null;

                if (creds.isAdmin) {
                    const admin = profilesData.niabat_profiles_admin_v1;
                    if (admin && admin.password === creds.hash) {
                        isValid = true; payload = { id: 'admin', role: 'super_admin' };
                    }
                } else {
                    const emps = profilesData.niabat_employee_profiles_v1 || [];
                    const emp = emps.find(e => e.id === creds.id && e.password === creds.hash && e.active !== false);
                    if (emp) {
                        isValid = true; payload = { id: emp.id, role: emp.accessRole };
                    }
                }

                if (isValid && payload) {
                    const token = createToken(payload);
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Set-Cookie': `niabat_token=${token}; Path=/; HttpOnly; SameSite=Lax`
                    });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false }));
                }
            } catch (e) { res.writeHead(400); res.end(); }
        });
        return;
    }

    // 2. تسجيل الخروج
    if (req.url === '/api/logout' && req.method === 'POST') {
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': `niabat_token=; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
        });
        return res.end(JSON.stringify({ success: true }));
    }

    // 3. جلب بيانات المحاضر
    if (req.url === '/api/data' && req.method === 'GET') {
        if (!userSession) { res.writeHead(403); return res.end(JSON.stringify({ mahdar_index: [] })); }
        const data = await readDataDirectly();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(data);
    }

    // 4. حفظ بيانات المحاضر
    if (req.url === '/api/data' && req.method === 'POST') {
        if (!userSession) { res.writeHead(403); return res.end('Access Denied'); }
        const recordKey = req.headers['x-record-key'] ? decodeURIComponent(req.headers['x-record-key']) : null;
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            if (recordKey) {
                let incoming;
                try { incoming = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end('Invalid JSON'); }
                const currentRaw = await readDataDirectly();
                let current;
                try {
                    current = currentRaw ? JSON.parse(currentRaw) : { mahdar_index: [] };
                } catch (e) { current = { mahdar_index: [] }; }

                if (req.headers['x-delete-record'] === 'true') {
                    delete current[recordKey];
                } else if (Object.prototype.hasOwnProperty.call(incoming, recordKey)) {
                    current[recordKey] = Object.assign({}, current[recordKey] || {}, incoming[recordKey]);
                }

                if (recordKey.indexOf('mahdar_') === 0) {
                    let index = Array.isArray(current.mahdar_index) ? current.mahdar_index : [];
                    const pos = index.indexOf(recordKey);
                    if (req.headers['x-delete-record'] === 'true') {
                        if (pos !== -1) index.splice(pos, 1);
                    } else if (pos === -1) { index.push(recordKey); }
                    current.mahdar_index = index;
                }

                await safeWriteData(JSON.stringify(current, null, 4));
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                return res.end('Saved');
            }

            await safeWriteData(body);
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Saved');
        });
        return;
    }

    // 5. جلب البروفايلات
    if (req.url === '/api/profiles' && req.method === 'GET') {
        const data = await readProfilesDirectly();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(data);
    }

    // 6. حفظ البروفايلات
    if (req.url === '/api/profiles' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            const rawProfiles = await readProfilesDirectly();
            const current = JSON.parse(rawProfiles || '{}');
            const hasAdmin = current.niabat_profiles_admin_v1 && current.niabat_profiles_admin_v1.password;

            if (hasAdmin && (!userSession || (userSession.role !== 'super_admin' && userSession.role !== 'account_admin'))) {
                res.writeHead(403); return res.end('Access Denied: High Privileges Required');
            }

            let parsed;
            try { parsed = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end('Invalid JSON'); }

            if (parsed.niabat_employee_profiles_v1) {
                parsed.niabat_employee_profiles_v1.forEach(p => { if (p.password) p.password = hashPassword(p.password); });
            }
            if (parsed.niabat_profiles_admin_v1 && parsed.niabat_profiles_admin_v1.password) {
                parsed.niabat_profiles_admin_v1.password = hashPassword(parsed.niabat_profiles_admin_v1.password);
            }

            await safeWriteProfiles(parsed);
            res.writeHead(200);
            res.end('Saved');
        });
        return;
    }

    // 7. حماية الصفحات الفرعية ومنع فتح الروابط مباشرة
    let filePath = req.url === '/' ? path.join(PUBLIC_DIR, 'بوابه_نيابه_مرور_عين_الصيره.html') : path.join(PUBLIC_DIR, decodeURI(req.url));
    let extname = String(path.extname(filePath)).toLowerCase();

    if (extname === '.html' && req.url !== '/' && !decodeURI(req.url).includes('بوابه_نيابه_مرور_عين_الصيره')) {
        if (!userSession) {
            res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(`
                <html dir="rtl">
                <head><title>وصول مرفوض</title><style>body{background:#0d1b2e;color:#f87171;font-family:sans-serif;text-align:center;padding-top:100px;}</style></head>
                <body>
                    <h1 style="font-size:60px;margin-bottom:10px;">⛔</h1>
                    <h1>وصول غير مصرح به!</h1>
                    <p style="color:#c8d4e8;line-height:1.8;">لا يمكنك الدخول إلى أنظمة البوابة الفرعية بشكل مباشر.<br>الرجاء العودة وتسجيل الدخول من البوابة الرئيسية.</p>
                    <a href="/" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#c9a84c;color:#0d1b2e;text-decoration:none;border-radius:10px;font-weight:bold;">العودة للبوابة الرئيسية</a>
                </body>
                </html>
            `);
        }
        if (req.headers['sec-fetch-dest'] === 'document') {
            res.writeHead(302, { 'Location': '/' });
            return res.end();
        }
    }

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
