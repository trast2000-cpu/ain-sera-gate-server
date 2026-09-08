const http = require('http');
const fs = require('fs');
const path = require('path');
const { Redis } = require('@upstash/redis');

// إصلاح مشكلة ظهور الحروف العربية كمربعات في شاشة CMD على ويندوز:
if (process.platform === 'win32') {
    try {
        require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
    } catch (e) {}
}

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'ain-sera-gate_v7');
const REDIS_KEY = 'ain_sera_database_records';

// محاولة الاتصال بقاعدة البيانات السحابية (تعمل فقط على Vercel)
let redis;
try {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        redis = Redis.fromEnv();
    }
} catch (e) {}

// منع فقدان تحديث أحد النظامين إذا وصل طلبان للحفظ في نفس الوقت
let recordWriteQueue = Promise.resolve();
function enqueueRecordWrite(task) {
    const operation = recordWriteQueue.then(task, task);
    recordWriteQueue = operation.catch(() => {});
    return operation;
}

// دالة القراءة المباشرة (تختار السحابة لو متاحة، أو الملف المحلي)
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

// قراءة البيانات من خلال الطابور (Queue)
function safeReadData() {
    return enqueueRecordWrite(() => readDataDirectly());
}

// كتابة البيانات (في السحابة أو في الملف المحلي بأمان)
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

// إنشاء ملف data.json تلقائياً محلياً
if (!redis && !fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ mahdar_index: [] }));
}

// قاموس ترجمة أسماء الأقسام للعرض في شاشة CMD
const stationTranslation = {
    '15 مايو': '15_May', 'الأزبكية': 'El_Azbakeya', 'الأميرية': 'El_Amireya', 'البساتين': 'El_Basatin',
    'التبين': 'El_Tebbin', 'التجمع الأول': 'First_Settlement', 'التجمع الخامس': 'Fifth_Settlement', 'الجمالية': 'El_Gamaleya',
    'الخليفة': 'El_Khalifa', 'الدرب الأحمر': 'El_Darb_El_Ahmar', 'الزاوية الحمراء': 'El_Zawya_El_Hamra', 'الزيتون': 'El_Zeitoun',
    'الساحل': 'El_Sahel', 'السيدة زينب': 'Sayeda_Zeinab', 'الشرابية': 'El_Sharabeya', 'الشروق': 'El_Shorouk',
    'الظاهر': 'El_Daher', 'القطامية': 'Katameya', 'المرج': 'El_Marg', 'المطرية': 'El_Matareya',
    'المعادي': 'Maadi', 'المعصرة': 'El_Maasara', 'المقطم': 'El_Mokattam', 'الموسكي': 'El_Mosky',
    'النزهة': 'El_Nozha', 'الوايلي': 'El_Waily', 'باب الشعرية': 'Bab_El_Shereya', 'بدر': 'Badr',
    'بولاق': 'Bulaq', 'حدائق القبة': 'Hadayek_El_Kobba', 'حلوان': 'Helwan', 'دار السلام': 'Dar_El_Salam',
    'روض الفرج': 'Rod_El_Farag', 'شبرا': 'Shoubra', 'عابدين': 'Abdeen', 'عين شمس': 'Ain_Shams',
    'قصر النيل': 'Qasr_El_Nil', 'مدينة السلام أول': 'Madinet_El_Salam_1', 'مدينة السلام ثان': 'Madinet_El_Salam_2',
    'مدينة نصر أول': 'Nasr_City_1', 'مدينة نصر ثان': 'Nasr_City_2', 'مدينة نصر ثالث': 'Nasr_City_3',
    'مصر الجديدة': 'Heliopolis', 'مصر القديمة': 'Misr_El_Adima', 'منشأة ناصر': 'Manshiyat_Naser', 'عين الصيرة': 'Ain_El_Sira'
};

function getDisplaySafeKey(recordKey) {
    let displayKey = String(recordKey || '');
    let matched = false;
    for (const [arabicName, englishName] of Object.entries(stationTranslation)) {
        if (displayKey.includes(arabicName)) {
            displayKey = displayKey.replace(arabicName, englishName);
            matched = true;
            break;
        }
    }
    if (!matched) {
        displayKey = displayKey.replace(/[^\x00-\x7F]/g, '').replace(/\s+/g, ' ').trim();
    }
    return displayKey;
}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Record-Key, X-Delete-Record');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    // 1. مسار جلب البيانات من السيرفر
    if (req.url === '/api/data' && req.method === 'GET') {
        safeReadData().then(data => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(data);
        });
        return;
    }

    // 2. مسار حفظ البيانات في السيرفر
    if (req.url === '/api/data' && req.method === 'POST') {
        const isCloud = !!redis;
        console.log(`[INFO] Save request received... (Mode: ${isCloud ? 'Cloud/Upstash' : 'Local/File'})`);
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
                        console.log(`[SUCCESS] Record [${getDisplaySafeKey(recordKey)}] saved successfully!`);
                        res.writeHead(200, { 'Content-Type': 'text/plain' });
                        res.end('Saved');
                    }).catch(err => {
                        console.log('[ERROR] Failed to save record:', err);
                        res.writeHead(500);
                        res.end('Error');
                    });
                }));
                return;
            }

            enqueueRecordWrite(() => safeWriteData(body)).then(() => {
                console.log('[SUCCESS] Full Data saved successfully!');
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Saved');
            }).catch(err => {
                console.log('[ERROR] Failed to save full data:', err);
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
