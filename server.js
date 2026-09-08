const http = require('http');
const fs = require('fs');
const path = require('path');

// إصلاح مشكلة ظهور الحروف العربية كمربعات في شاشة CMD على ويندوز:
// نبدّل ترميز الشاشة تلقائيًا إلى UTF-8 (صفحة الترميز 65001) عند بدء تشغيل السيرفر.
// ملاحظة: هذا يضبط الترميز فقط؛ خط الشاشة نفسه (Font) قد يحتاج ضبطًا يدويًا مرة واحدة
// (Consolas أو Lucida Console) لأن الخط الافتراضي "Raster Fonts" لا يعرض الحروف العربية أصلاً.
if (process.platform === 'win32') {const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// إصلاح مشكلة ظهور الحروف العربية كمربعات في شاشة CMD على ويندوز:
// نبدّل ترميز الشاشة تلقائيًا إلى UTF-8 (صفحة الترميز 65001) عند بدء تشغيل السيرفر.
// ملاحظة: هذا يضبط الترميز فقط؛ خط الشاشة نفسه (Font) قد يحتاج ضبطًا يدويًا مرة واحدة
// (Consolas أو Lucida Console) لأن الخط الافتراضي "Raster Fonts" لا يعرض الحروف العربية أصلاً.
if (process.platform === 'win32') {
try {
require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
} catch (e) {}
}

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
// تعريف مجلد البوابة ليكون هو المصدر لكل الملفات
const PUBLIC_DIR = path.join(__dirname, 'ain-sera-gate_v7');
// مجلد ملفات الوورد/النصوص (نفس المجلد اللي زرار "نسخ مسار" بينسخ مساره الشبكي)
const FILES_DIR = path.join(PUBLIC_DIR, 'files');

// تجميع كل عناوين الـ IP الخاصة بجهاز السيرفر نفسه (اللوكال + كل كروت الشبكة)
// عشان نقدر نفرّق هل الطلب جايلنا من نفس جهاز السيرفر ولا من جهاز تاني على الشبكة
function getServerLocalIPs() {
const ips = new Set(['127.0.0.1', '::1']);
const interfaces = os.networkInterfaces();
for (const name of Object.keys(interfaces)) {
for (const iface of interfaces[name] || []) {
ips.add(iface.address);
}
}
return ips;
}
const SERVER_LOCAL_IPS = getServerLocalIPs();

function isRequestFromServerDevice(req) {
let remoteAddress = req.socket.remoteAddress || '';
// إزالة بادئة IPv4-mapped IPv6 (زي ::ffff:127.0.0.1) عشان تتقارن صح بعنوان IPv4 عادي
if (remoteAddress.indexOf('::ffff:') === 0) {
remoteAddress = remoteAddress.substring(7);
}
return SERVER_LOCAL_IPS.has(remoteAddress);
}
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

// --- قاموس ترجمة أسماء الأقسام للعرض في شاشة CMD فقط (لا يُستخدم في الحفظ الفعلي) ---
const stationTranslation = {
'15 مايو': '15_May',
'الأزبكية': 'El_Azbakeya',
'الأميرية': 'El_Amireya',
'البساتين': 'El_Basatin',
'التبين': 'El_Tebbin',
'التجمع الأول': 'First_Settlement',
'التجمع الخامس': 'Fifth_Settlement',
'الجمالية': 'El_Gamaleya',
'الخليفة': 'El_Khalifa',
'الدرب الأحمر': 'El_Darb_El_Ahmar',
'الزاوية الحمراء': 'El_Zawya_El_Hamra',
'الزيتون': 'El_Zeitoun',
'الساحل': 'El_Sahel',
'السيدة زينب': 'Sayeda_Zeinab',
'الشرابية': 'El_Sharabeya',
'الشروق': 'El_Shorouk',
'الظاهر': 'El_Daher',
'القطامية': 'Katameya',
'المرج': 'El_Marg',
'المطرية': 'El_Matareya',
'المعادي': 'Maadi',
'المعصرة': 'El_Maasara',
'المقطم': 'El_Mokattam',
'الموسكي': 'El_Mosky',
'النزهة': 'El_Nozha',
'الوايلي': 'El_Waily',
'باب الشعرية': 'Bab_El_Shereya',
'بدر': 'Badr',
'بولاق': 'Bulaq',
'حدائق القبة': 'Hadayek_El_Kobba',
'حلوان': 'Helwan',
'دار السلام': 'Dar_El_Salam',
'روض الفرج': 'Rod_El_Farag',
'شبرا': 'Shoubra',
'عابدين': 'Abdeen',
'عين شمس': 'Ain_Shams',
'قصر النيل': 'Qasr_El_Nil',
'مدينة السلام أول': 'Madinet_El_Salam_1',
'مدينة السلام ثان': 'Madinet_El_Salam_2',
'مدينة نصر أول': 'Nasr_City_1',
'مدينة نصر ثان': 'Nasr_City_2',
'مدينة نصر ثالث': 'Nasr_City_3',
'مصر الجديدة': 'Heliopolis',
'مصر القديمة': 'Misr_El_Adima',
'منشأة ناصر': 'Manshiyat_Naser',
'عين الصيرة': 'Ain_El_Sira'
};

// إعداد نسخة آمنة للعرض في الشاشة من مفتاح السجل: نترجم اسم القسم لو موجود بالقاموس،
// وإلا (قسم جديد أو صيغة غير متوقعة) نشيل أي حروف غير ASCII بدل ما تطبع مربعات.
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

// تحديث الفهرس: إضافة المفتاح فقط لو كان جديداً تماماً (لم يكن موجوداً من قبل) —
// مفتاح موجود بالفعل يفضل في مكانه بالفهرس حتى لو اندمجت عليه بيانات جديدة
// (زي بيانات سداد من نظام تاني)، حتى لا يظهر المحضر وكأنه انتقل ليوم اليوم
// في قوائم المحاضر المحفوظة رغم أن تاريخ تسجيله الأصلي (savedAt) لم يتغير.
// وده يخص مفاتيح المحاضر (mahdar_...) فقط؛ مفاتيح تانية زي الإعدادات
// أو سجل العرائض بتتدمج فوق بس من غير ما تتسجل في هذا الفهرس
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

fs.writeFile(DATA_FILE, JSON.stringify(current, null, 4), 'utf8', err => {
if (err) {
console.log('[ERROR] An error occurred while writing to the file:', err);
res.writeHead(500);
resolve();
return res.end('Error');
}

console.log(`[SUCCESS] Record [${getDisplaySafeKey(recordKey)}] merged and saved successfully!`);

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


// مسار ذكي لفتح الملفات مباشرة عبر السيرفر بأي امتداد (وورد، نصوص، إلخ)
// مسار ذكي لفتح الملفات مباشرة عبر السيرفر بأي امتداد (وورد، نصوص، إلخ) —
// بس لو الطلب جاي من نفس جهاز السيرفر؛ أي جهاز تاني في الشبكة يرجعله
// success:false + isRemote:true عشان الصفحة تلجأ تلقائيًا لنسخ مسار الملف
// بدل ما تحاول تفتح حاجة هتفتح فعليًا على شاشة جهاز السيرفر مش عندهم
if (req.url === '/api/open-word' && req.method === 'POST') {
        if (!isRequestFromServerDevice(req)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, isRemote: true }));
        }
let body = '';
req.on('data', chunk => { body += chunk.toString(); });
req.on('end', () => {
try {
const data = JSON.parse(body);
const requestedPath = data.filePath;

if (!requestedPath) {
res.writeHead(400, { 'Content-Type': 'application/json' });
return res.end(JSON.stringify({ success: false, error: 'لم يتم توفير مسار الملف' }));
}

// المسار الكامل للملف بناءً على المجلد
let fullPath = path.join(PUBLIC_DIR, requestedPath);

// 💡 الفحص الذكي: إذا كان الملف بالامتداد المطلوب غير موجود، نبحث عن أي امتداد آخر
if (!fs.existsSync(fullPath)) {
const dirName = path.dirname(fullPath);
const baseName = path.basename(fullPath, path.extname(fullPath)); // استخراج الاسم بدون الامتداد

if (fs.existsSync(dirName)) {
const filesInDir = fs.readdirSync(dirName);
// البحث عن ملف يحمل نفس الاسم بالضبط بغض النظر عن الامتداد (.doc, .txt, الخ)
const matchedFile = filesInDir.find(f => path.basename(f, path.extname(f)) === baseName);

if (matchedFile) {
// تم العثور على الملف بامتداد مختلف (تحديث المسار)
fullPath = path.join(dirName, matchedFile); 
} else {
res.writeHead(404, { 'Content-Type': 'application/json' });
return res.end(JSON.stringify({ success: false, error: 'الملف غير موجود بأي امتداد' }));
}
} else {
res.writeHead(404, { 'Content-Type': 'application/json' });
return res.end(JSON.stringify({ success: false, error: 'المجلد غير موجود' }));
}
}

// استخدام أمر الويندوز لفتح الملف بالبرنامج المرتبط به في النظام
const { exec } = require('child_process');
const command = `start "" "${fullPath}"`;

exec(command, (error) => {
if (error) {
console.error('[ERROR] Opening file:', error);
res.writeHead(500, { 'Content-Type': 'application/json' });
return res.end(JSON.stringify({ success: false, error: 'حدث خطأ أثناء فتح الملف من نظام التشغيل' }));
}
console.log(`[SUCCESS] File opened with its default app: ${fullPath}`);
res.writeHead(200, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ success: true }));
});
} catch (e) {
console.error('[ERROR] Parsing open-word request:', e);
res.writeHead(400, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
}
});
return;
}



// مسار فتح مجلد الملفات مباشرة — بس لو الطلب جاي من نفس جهاز السيرفر؛
// أي جهاز تاني في الشبكة يرجعله success:false + isRemote:true عشان
// الصفحة تلجأ تلقائيًا لنسخ المسار الشبكي بدل ما تحاول تفتح حاجة مالهاش لازمة عنده
if (req.url === '/api/open-folder' && req.method === 'POST') {
if (!isRequestFromServerDevice(req)) {
res.writeHead(200, { 'Content-Type': 'application/json' });
return res.end(JSON.stringify({ success: false, isRemote: true }));
}
const { exec } = require('child_process');
exec(`start "" "${FILES_DIR}"`, (error) => {
if (error) {
console.error('[ERROR] Opening folder:', error);
res.writeHead(500, { 'Content-Type': 'application/json' });
return res.end(JSON.stringify({ success: false, error: 'حدث خطأ أثناء فتح المجلد' }));
}
console.log('[SUCCESS] Files folder opened on the server device.');
res.writeHead(200, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ success: true, opened: true }));
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
    try {
        require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
    } catch (e) {}
}

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
// تعريف مجلد البوابة ليكون هو المصدر لكل الملفات
const PUBLIC_DIR = path.join(__dirname, 'ain-sera-gate_v7');
// منع فقدان تحديث أحد النظامين إذا وصل طلبان للحفظ في نفس الوقت.
// كل عملية تلمس data.json (قراءة أو كتابة) لازم تعدي من هنا، مش الكتابة بس —
// عشان لو جهاز بيقرأ الملف في نفس لحظة ما جهاز تاني بيكتب فيه، القراءة ممكن
// تمسك الملف "نص كتابة" (نص بيانات قديمة ونص جديدة)، ولو نقطة التلاقي وقعت
// في نص حرف عربي (٢ بايت UTF-8) بيتحول لعلامة استفهام (�) وتترسّخ في الملف
// لو الجهاز اللي قرأها كتب فوقها تاني.
let recordWriteQueue = Promise.resolve();
function enqueueRecordWrite(task) {
    const operation = recordWriteQueue.then(task, task);
    recordWriteQueue = operation.catch(() => {});
    return operation;
}

// قراءة data.json بأمان (جوه الـ queue، عشان ميحصلش تصادم مع كتابة شغالة في نفس اللحظة).
function safeReadData() {
    return enqueueRecordWrite(() => new Promise(resolve => {
        fs.readFile(DATA_FILE, 'utf8', (err, data) => {
            resolve(data || '{}');
        });
    }));
}

// كتابة data.json بأمان: بنكتب في ملف مؤقت ثم نستبدله بالملف الأصلي دفعة واحدة (rename)،
// عشان لو حصل أي قطع أثناء الكتابة (انقطاع كهرباء، تعليق الجهاز...) الملف الأصلي
// يفضل سليم كامل بدل ما يتقطع في نصه.
function safeWriteData(content) {
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

// إنشاء ملف data.json تلقائياً إذا لم يكن موجوداً
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ mahdar_index: [] }));
}

// --- قاموس ترجمة أسماء الأقسام للعرض في شاشة CMD فقط (لا يُستخدم في الحفظ الفعلي) ---
const stationTranslation = {
    '15 مايو': '15_May',
    'الأزبكية': 'El_Azbakeya',
    'الأميرية': 'El_Amireya',
    'البساتين': 'El_Basatin',
    'التبين': 'El_Tebbin',
    'التجمع الأول': 'First_Settlement',
    'التجمع الخامس': 'Fifth_Settlement',
    'الجمالية': 'El_Gamaleya',
    'الخليفة': 'El_Khalifa',
    'الدرب الأحمر': 'El_Darb_El_Ahmar',
    'الزاوية الحمراء': 'El_Zawya_El_Hamra',
    'الزيتون': 'El_Zeitoun',
    'الساحل': 'El_Sahel',
    'السيدة زينب': 'Sayeda_Zeinab',
    'الشرابية': 'El_Sharabeya',
    'الشروق': 'El_Shorouk',
    'الظاهر': 'El_Daher',
    'القطامية': 'Katameya',
    'المرج': 'El_Marg',
    'المطرية': 'El_Matareya',
    'المعادي': 'Maadi',
    'المعصرة': 'El_Maasara',
    'المقطم': 'El_Mokattam',
    'الموسكي': 'El_Mosky',
    'النزهة': 'El_Nozha',
    'الوايلي': 'El_Waily',
    'باب الشعرية': 'Bab_El_Shereya',
    'بدر': 'Badr',
    'بولاق': 'Bulaq',
    'حدائق القبة': 'Hadayek_El_Kobba',
    'حلوان': 'Helwan',
    'دار السلام': 'Dar_El_Salam',
    'روض الفرج': 'Rod_El_Farag',
    'شبرا': 'Shoubra',
    'عابدين': 'Abdeen',
    'عين شمس': 'Ain_Shams',
    'قصر النيل': 'Qasr_El_Nil',
    'مدينة السلام أول': 'Madinet_El_Salam_1',
    'مدينة السلام ثان': 'Madinet_El_Salam_2',
    'مدينة نصر أول': 'Nasr_City_1',
    'مدينة نصر ثان': 'Nasr_City_2',
    'مدينة نصر ثالث': 'Nasr_City_3',
    'مصر الجديدة': 'Heliopolis',
    'مصر القديمة': 'Misr_El_Adima',
    'منشأة ناصر': 'Manshiyat_Naser',
    'عين الصيرة': 'Ain_El_Sira'
};

// إعداد نسخة آمنة للعرض في الشاشة من مفتاح السجل: نترجم اسم القسم لو موجود بالقاموس،
// وإلا (قسم جديد أو صيغة غير متوقعة) نشيل أي حروف غير ASCII بدل ما تطبع مربعات.
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
    // بتعدي من نفس الـ queue بتاع الكتابة، عشان ميحصلش "قراءة ناقصة" (نص بيانات
    // قديمة ونص جديدة) لو جهاز تاني بيكتب الملف في نفس اللحظة بالظبط.
    if (req.url === '/api/data' && req.method === 'GET') {
        safeReadData().then(data => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(data);
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
                    // ملاحظة: القراءة هنا آمنة لأننا أصلاً جوه enqueueRecordWrite،
                    // فمفيش كتابة تانية ممكن تكون شغالة في نفس اللحظة.
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

                    // تحديث الفهرس: إضافة المفتاح فقط لو كان جديداً تماماً (لم يكن موجوداً من قبل) —
                    // مفتاح موجود بالفعل يفضل في مكانه بالفهرس حتى لو اندمجت عليه بيانات جديدة
                    // (زي بيانات سداد من نظام تاني)، حتى لا يظهر المحضر وكأنه انتقل ليوم اليوم
                    // في قوائم المحاضر المحفوظة رغم أن تاريخ تسجيله الأصلي (savedAt) لم يتغير.
                    // وده يخص مفاتيح المحاضر (mahdar_...) فقط؛ مفاتيح تانية زي الإعدادات
                    // أو سجل العرائض بتتدمج فوق بس من غير ما تتسجل في هذا الفهرس
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

                    safeWriteData(JSON.stringify(current, null, 4)).then(() => {
                        console.log(`[SUCCESS] Record [${getDisplaySafeKey(recordKey)}] merged and saved successfully!`);

                        res.writeHead(200, { 'Content-Type': 'text/plain' });
                        resolve();
                        res.end('Saved');
                    }).catch(err => {
                        console.log('[ERROR] An error occurred while writing to the file:', err);
                        res.writeHead(500);
                        resolve();
                        res.end('Error');
                    });
                });
                }));
                return;
            }

            // لا يوجد X-Record-Key: عملية عامة (مثل الحذف الكامل لمحضر) — نفس الكتابة
            // القديمة، لكن دلوقتي بتعدي من نفس الـ queue بتاع باقي الكتابات، عشان
            // ميحصلش تصادم حقيقي (كتابتان في نفس اللحظة بالظبط) مع حفظ محضر شغال
            // في نفس الوقت من جهاز تاني.
            enqueueRecordWrite(() => safeWriteData(body)).then(() => {
                console.log('[SUCCESS] Data saved successfully to data.json!'); // رسالة نجاح
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Saved');
            }).catch(err => {
                console.log('[ERROR] An error occurred while writing to the file:', err);
                res.writeHead(500);
                res.end('Error');
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
