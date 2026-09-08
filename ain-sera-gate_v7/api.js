// استخدام مسار نسبي ليعمل تلقائياً على السيرفر المحلي وعلى Vercel بأمان وبدون حظر
const SERVER_URL = (window.location.protocol.startsWith('http')) 
    ? '/api/data' 
    : `http://${window.location.hostname || 'localhost'}:3000/api/data`;

// هوية موحدة للمحضر تستخدمها كل الأنظمة.
// لا نغيّر شكل الحروف العربية (مثل ة) حتى تظل المفاتيح القديمة صالحة،
// ونكتفي بتوحيد المسافات والأرقام وبعض أشكال الألف الشائعة.
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

// الوضعان main و objection أصلان مستقلان.
// تخفيض الكفالة تابع للأصل الذي فُتح منه:
// main      -> mahdar_...__bail_reduction
// objection -> mahdar_...__objection__bail_reduction
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

// قراءة البيانات من السيرفر (مع منع الكاش وحماية البيانات)
async function fetchServerData() {
    try {
        let res = await fetch(SERVER_URL, { 
            method: 'GET',
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
        
        let data = await res.json();
        
        // درع الحماية: لو الملف كان مصفوفة [] أو كائن فارغ {}، هيصلحه تلقائياً
        if (Array.isArray(data) || Object.keys(data).length === 0) {
            return { mahdar_index: [] };
        }
        
        return data;
    } catch(error) {
        console.error("خطأ في الاتصال بالسيرفر:", error);
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

// حذف سجل واحد دون استبدال قاعدة البيانات كاملة.
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
        console.error("خطأ في حذف المحضر من السيرفر:", error);
        return false;
    }
}
