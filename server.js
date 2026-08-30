const http = require('http');
const fs = require('fs');
const path = require('path');

// إصلاح مشكلة ظهور الحروف العربية كمربعات في شاشة CMD على ويندوز:
// نبدّل ترميز الشاشة تلقائيًا إلى UTF-8 (صفحة الترميز 65001) عند بدء تشغيل السيرفر.
// ملاحظة: هذا يضبط الترميز فقط؛ خط الشاشة نفسه (Font) قد يحتاج ضبطًا يدويًا مرة واحدة
// (Consolas أو Lucida Console) لأن الخط الافتراضي "Raster Fonts" لا يعرض الحروف العربية أصلاً.
if (process.platform === 'win32') {
    try {
        require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
    } catch (e) {}
}

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
// تعريف مجلد البوابة ليكون هو المصدر لكل الملفات
const PUBLIC_DIR = path.join(__dirname, 'ain-sera-gate_v7');
// منع فقدان تحديث أحد النظامين إذا وصل طلبان للحفظ في نفس الوقت.
let recordWriteQueue = Promise.resolve();
function enqueueRecordWrite(task) {
    const operation = recordWriteQueue.then(task, task);
    recordWriteQueue = operation.catch(() => {});
    return operation;
}

// إنشاء ملف data.json تلقائياً إذا لم يكن موجوداً
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ mahdar_index: [] }));
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
        fs.readFile(DATA_FILE, 'utf8', (err, data) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(data || '{}');
        });
        return;
    }

   // 2. مسار حفظ البيانات في السيرفر
    if (req.url === '/api/data' && req.method === 'POST') {
        console.log('[INFO] Server received a save request from the browser...'); // رسالة تأكيد
        const recordKey = req.headers['x-record-key'] ? decodeURIComponent(req.headers['x-record-key']) : null;
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            // لو الطلب مرتبط بمحضر معيّن (X-Record-Key)، ندمج سجل هذا المحضر فقط
            // فوق أحدث نسخة موجودة فعلياً على القرص، بدل ما نستبدل الملف كله بالنسخة
            // اللي كانت عند المتصفح وقت ما عمل fetch (واللي ممكن تبقى قديمة لو نظام
            // تاني (تلبسات/التحقيق) حفظ حاجة في نفس الوقت تقريباً).
            if (recordKey) {
                let incoming;
                try {
                    incoming = JSON.parse(body);
                } catch (e) {
                    console.log('[ERROR] Invalid JSON received in save request:', e);
                    res.writeHead(400);
                    return res.end('Invalid JSON');
                }

                enqueueRecordWrite(() => new Promise(resolve => {
                fs.readFile(DATA_FILE, 'utf8', (readErr, currentRaw) => {
                    let current;
                    try {
                        current = currentRaw ? JSON.parse(currentRaw) : {};
                        if (Array.isArray(current) || typeof current !== 'object' || current === null) {
                            current = { mahdar_index: [] };
                        }
                    } catch (e) {
                        current = { mahdar_index: [] };
                    }

                    // حذف سجل المحضر نفسه فقط (وليس كل قاعدة البيانات)
                    if (req.headers['x-delete-record'] === 'true') {
                        delete current[recordKey];
                    // دمج سجل المحضر نفسه فقط (وليس كل قاعدة البيانات)
                    } else if (Object.prototype.hasOwnProperty.call(incoming, recordKey)) {
                        current[recordKey] = Object.assign({}, current[recordKey] || {}, incoming[recordKey]);
                    }

                    // تحديث الفهرس: إضافة المفتاح لو مش موجود، مع نقله لآخر الفهرس (الأحدث) —
                    // وده يخص مفاتيح المحاضر (mahdar_...) فقط؛ مفاتيح تانية زي الإعدادات
                    // أو سجل العرائض بتتدمج فوق بس من غير ما تتسجل في هذا الفهرس
                    if (recordKey.indexOf('mahdar_') === 0) {
                        let index = Array.isArray(current.mahdar_index) ? current.mahdar_index : [];
                        const existingPos = index.indexOf(recordKey);
                        if (existingPos !== -1) index.splice(existingPos, 1);
                        if (req.headers['x-delete-record'] !== 'true') index.push(recordKey);
                        current.mahdar_index = index;
                    } else if (!Array.isArray(current.mahdar_index)) {
                        current.mahdar_index = [];
                    }

                    fs.writeFile(DATA_FILE, JSON.stringify(current, null, 4), 'utf8', err => {
                        if (err) {
                            console.log('[ERROR] An error occurred while writing to the file:', err);
                            res.writeHead(500);
                            resolve();
                            return res.end('Error');
                        }
                        console.log(`[SUCCESS] Record [${recordKey}] merged and saved successfully!`);
                        res.writeHead(200, { 'Content-Type': 'text/plain' });
                        resolve();
                        res.end('Saved');
                    });
                });
                }));
                return;
            }

            // لا يوجد X-Record-Key: عملية عامة (مثل الحذف الكامل لمحضر) — نكتب الملف كما وصل كما كان الحال سابقاً
            fs.writeFile(DATA_FILE, body, 'utf8', err => {
                if(err) {
                    console.log('[ERROR] An error occurred while writing to the file:', err);
                    res.writeHead(500);
                    return res.end('Error');
                }
                console.log('[SUCCESS] Data saved successfully to data.json!'); // رسالة نجاح
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Saved');
            });
        });
        return;
    }

    // 3. عرض ملفات البوابة (HTML, CSS, JS, Images)
    let filePath = '';
    if (req.url === '/') {
        // هنا حطينا اسم الملف الحقيقي بتاعك
        filePath = path.join(PUBLIC_DIR, 'بوابه_نيابه_مرور_عين_الصيره.html');
    } else {
        // أي ملف تاني (زي الصور أو الجافاسكريبت) هيجيبه من داخل المجلد
        filePath = path.join(PUBLIC_DIR, decodeURI(req.url));
    }
    
    let extname = String(path.extname(filePath)).toLowerCase();
    let mimeTypes = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
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
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('Server is running and serving files!');
    console.log(`Port: ${PORT}`);
});