// استشعار البيئة تلقائياً (محلي أو أونلاين) لمنع أخطاء CORS
const IS_PROD = window.location.protocol.startsWith('https') || window.location.hostname !== 'localhost';
const BASE_URL = IS_PROD ? '' : `http://${window.location.hostname || 'localhost'}:3000`;

const SERVER_URL = `${BASE_URL}/api/data`;
const PROFILES_SERVER_URL = `${BASE_URL}/api/profiles`;
const AUTH_URL = `${BASE_URL}/api/auth`;
const LOGOUT_URL = `${BASE_URL}/api/logout`;

// هوية موحدة للمحضر تستخدمها كل الأنظمة.
function normalizeMahdarPart(value) {
    return String(value ?? '')
        .trim()
        .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/[أإآ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/^(?:قسم\s*شرطة|قسم)\s+/u, '')
        .replace(/\s+/g, ' ');
}

function getMahdarBaseKey(caseNum, year, dept) {
    return 'mahdar_' + [
        normalizeMahdarPart(caseNum),
        normalizeMahdarPart(year),
        normalizeMahdarPart(dept)
    ].join('_');
}

function getMahdarKey(caseNum, year, dept, mode = 'main', parentMode = 'main') {
    const baseKey = getMahdarBaseKey(caseNum, year, dept);
    if (mode === 'objection') return baseKey + '__objection';
    if (mode === 'bail_reduction' && parentMode === 'objection') {
        return baseKey + '__objection__bail_reduction';
    }
    if (mode === 'bail_reduction') return baseKey + '__bail_reduction';
    return baseKey;
}

function getMahdarParentKey(caseNum, year, dept, mode, parentMode = 'main') {
    if (mode !== 'bail_reduction') return null;
    return getMahdarKey(caseNum, year, dept, parentMode, 'main');
}

// === [دوال الحماية والمصادقة (إصدار الختم السري) مع السيرفر] ===
async function serverLogin(userId, passwordHash, isAdmin = false) {
    try {
        await fetch(AUTH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: userId, hash: passwordHash, isAdmin })
        });
    } catch(error) { console.error('خطأ في مصادقة السيرفر:', error); }
}

async function serverLogout() {
    try {
        await fetch(LOGOUT_URL, { method: 'POST' });
    } catch(error) { console.error('خطأ في تسجيل الخروج من السيرفر:', error); }
}
// ==============================================================

// قراءة البيانات من السيرفر (مع منع الكاش وحماية البيانات)
async function fetchServerData() {
    try {
        let res = await fetch(SERVER_URL, { 
            method: 'GET',
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' }
        });
        if (!res.ok) throw new Error('Unauthorized');
        let data = await res.json();
        if (Array.isArray(data) || Object.keys(data).length === 0) return { mahdar_index: [] };
        return data;
    } catch(error) {
        return { mahdar_index: [] };
    }
}

// حفظ كل البيانات في السيرفر
async function saveToServerData(dataObject, recordKey = null) {
    try {
        let headers = {
            'Content-Type': 'application/json',
            'X-Record-Key': recordKey ? encodeURIComponent(recordKey) : ''
        };
        await fetch(SERVER_URL, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(dataObject, null, 4)
        });
    } catch(error) {
        console.error("خطأ في إرسال البيانات للحفظ:", error);
    }
}

// حذف سجل واحد
async function deleteFromServerData(recordKey) {
    if (!recordKey) return false;
    try {
        const res = await fetch(SERVER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Record-Key': encodeURIComponent(recordKey),
                'X-Delete-Record': 'true'
            },
            body: '{}'
        });
        return res.ok;
    } catch (error) {
        return false;
    }
}

// قراءة ملف البروفايلات المستقل
async function fetchProfilesData() {
    try {
        const res = await fetch(PROFILES_SERVER_URL, {
            method: 'GET',
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
        });
        const data = await res.json();
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (error) {
        return {};
    }
}

// حفظ ملف البروفايلات المستقل فقط
async function saveProfilesData(dataObject) {
    try {
        const res = await fetch(PROFILES_SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataObject, null, 4)
        });
        return res.ok;
    } catch (error) {
        return false;
    }
}
