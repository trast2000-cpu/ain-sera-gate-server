const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

if (process.platform === "win32") {
  try {
    require("child_process").execSync("chcp 65001", { stdio: "ignore" });
  } catch (e) {}
}

// =====================================================================
//  نسخة واحدة تعمل في البيئتين:
//   - محليًا (node server.js): البيانات في ملفات data.json و profiles.json
//   - سحابيًا (Vercel + Upstash Redis): البيانات في Redis
//  يتم اختيار الوضع تلقائيًا من متغيرات البيئة، بدون أي تعديل في الكود.
// =====================================================================
const hasRedisEnv = !!(
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
);
const IS_CLOUD = hasRedisEnv || !!process.env.VERCEL;

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const PROFILES_FILE = path.join(__dirname, "profiles.json");
const PUBLIC_DIR = path.join(__dirname, "ain-sera-gate_v7");
// مجلد ملفات الوورد/النصوص (نفس المجلد اللي زرار "نسخ مسار" بينسخ مساره الشبكي) - محلي فقط
const FILES_DIR = path.join(PUBLIC_DIR, "files");

const REDIS_KEY = "ain_sera_database_records";
const REDIS_PROFILES_KEY = "ain_sera_profiles_records";

// المكتبة لا تُحمَّل إلا في الوضع السحابي، فلا تحتاج تتثبت على الجهاز المحلي.
let redis = null;
if (hasRedisEnv) {
  try {
    const { Redis } = require("@upstash/redis");
    redis = Redis.fromEnv();
  } catch (e) {
    console.error("[ERROR] Failed to initialise Upstash Redis:", e.message);
  }
}

// تجميع كل عناوين الـ IP الخاصة بجهاز السيرفر نفسه (اللوكال + كل كروت الشبكة)
// عشان نقدر نفرّق هل الطلب جايلنا من نفس جهاز السيرفر ولا من جهاز تاني على الشبكة
function getServerLocalIPs() {
  const ips = new Set(["127.0.0.1", "::1"]);
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      ips.add(iface.address);
    }
  }
  return ips;
}
const SERVER_LOCAL_IPS = IS_CLOUD ? new Set() : getServerLocalIPs();

function isRequestFromServerDevice(req) {
  let remoteAddress = req.socket.remoteAddress || "";
  // إزالة بادئة IPv4-mapped IPv6 (زي ::ffff:127.0.0.1) عشان تتقارن صح بعنوان IPv4 عادي
  if (remoteAddress.indexOf("::ffff:") === 0) {
    remoteAddress = remoteAddress.substring(7);
  }
  return SERVER_LOCAL_IPS.has(remoteAddress);
}

// === [محرك توليد الأختام السرية - Token Engine] ===
// محليًا: مفتاح عشوائي جديد مع كل تشغيل.
// سحابيًا: مفتاح ثابت (SESSION_SECRET) لمنع تسجيل الخروج العشوائي في Vercel.
const SECRET_KEY = IS_CLOUD
  ? process.env.SESSION_SECRET || "niabat_cloud_secure_session_key_2026_x99"
  : crypto.randomBytes(32).toString("hex");
const COOKIE_SAMESITE = IS_CLOUD ? "Lax" : "Strict";

function toBase64Url(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}
function toBase64UrlFromBuffer(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}
// صنع الختم
function createToken(payload) {
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = toBase64Url(JSON.stringify(payload));
  const signature = toBase64UrlFromBuffer(
    crypto
      .createHmac("sha256", SECRET_KEY)
      .update(header + "." + body)
      .digest()
  );
  return header + "." + body + "." + signature;
}
// التحقق من صحة الختم (مستحيل تزويره)
function verifyToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const signature = toBase64UrlFromBuffer(
    crypto
      .createHmac("sha256", SECRET_KEY)
      .update(parts[0] + "." + parts[1])
      .digest()
  );
  if (signature !== parts[2]) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
  } catch (e) {
    return null;
  }
}
// ====================================================

function hashPassword(password) {
  if (!password) return "";
  if (password.length === 64 && /^[0-9a-f]{64}$/i.test(password))
    return password;
  return crypto.createHash("sha256").update(password).digest("hex");
}

// مقارنة عميقة بين قيمتين بغض النظر عن ترتيب مفاتيح الكائنات
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const aKeys = Object.keys(a),
      bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k])
    );
  }
  return false;
}

// التحقق من أن التحديث المرسل هو "خدمة ذاتية" لموظف مسجّل دخوله:
// يعدّل سجله الخاص فقط (نفس عدد الموظفين ونفس الهويات)، ولا يمس بيانات المدير
// ولا بيانات أي موظف آخر بأي شكل.
function isSelfServiceProfilesUpdate(current, parsed, sessionEmployeeId) {
  const adminUnchanged = deepEqual(
    parsed.niabat_profiles_admin_v1 || null,
    current.niabat_profiles_admin_v1 || null
  );
  if (!adminUnchanged) return false;

  const currentEmps = Array.isArray(current.niabat_employee_profiles_v1)
    ? current.niabat_employee_profiles_v1
    : [];
  const incomingEmps = Array.isArray(parsed.niabat_employee_profiles_v1)
    ? parsed.niabat_employee_profiles_v1
    : null;
  if (!incomingEmps || incomingEmps.length !== currentEmps.length) return false;

  const currentIds = currentEmps.map((e) => e.id);
  const incomingIds = incomingEmps.map((e) => e.id);
  const sameIds =
    currentIds.length === incomingIds.length &&
    currentIds.every((id) => incomingIds.includes(id));
  if (!sameIds) return false;

  return incomingEmps.every((emp) => {
    if (emp.id === sessionEmployeeId) return true; // سجله الخاص: مسموح بالتعديل
    const match = currentEmps.find((e) => e.id === emp.id);
    return match && deepEqual(match, emp); // أي موظف آخر يجب أن يبقى كما هو تماماً
  });
}

// طابور الكتابة: عمليات القراءة/الكتابة تتنفذ واحدة بعد الأخرى داخل نفس السيرفر
let recordWriteQueue = Promise.resolve();
function enqueueRecordWrite(task) {
  const operation = recordWriteQueue.then(task, task);
  recordWriteQueue = operation.catch(() => {});
  return operation;
}

// =====================================================================
//  حماية البيانات (الوضع المحلي): نسخ احتياطية + كتابة آمنة
// =====================================================================
const BACKUP_DIR = path.join(__dirname, "backups");
const MAX_HOURLY_BACKUPS = 10; // آخر 10 نسخ فقط، والأقدم يتمسح تلقائيًا

function isValidJsonFile(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return false;
    JSON.parse(raw);
    return true;
  } catch (e) {
    return false;
  }
}

// قبل أي كتابة: نسخة سريعة (.bak) + نسخة مؤرخة مرة كل ساعة.
// لا تُنسخ إلا لو الملف الحالي سليم، فلا نكتب نسخة تالفة فوق نسخة جيدة.
function backupBeforeWrite(file) {
  try {
    if (!fs.existsSync(file) || !isValidJsonFile(file)) return;
    fs.copyFileSync(file, file + ".bak");
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const base = path.basename(file, ".json");
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp =
      "" +
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      "-" +
      pad(d.getHours());
    const hourlyFile = path.join(BACKUP_DIR, `${base}-${stamp}.json`);
    if (!fs.existsSync(hourlyFile)) {
      fs.copyFileSync(file, hourlyFile);
      const old = fs
        .readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith(base + "-") && f.endsWith(".json"))
        .sort();
      while (old.length > MAX_HOURLY_BACKUPS) {
        fs.unlinkSync(path.join(BACKUP_DIR, old.shift()));
      }
    }
  } catch (e) {
    console.log("[WARN] Backup failed:", e.message);
  }
}

// كتابة ذرّية: ملف مؤقت -> إفراغ على القرص (fsync) -> rename.
// حتى لو انقطعت الكهرباء لا يبقى ملف فاضي أو نصف مكتوب.
function atomicWriteFile(file, content) {
  const tmp = file + ".tmp";
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, content, null, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

// =====================================================================
//  حماية البيانات (الوضع السحابي): نسخ احتياطية داخل Redis نفسه
//    <key>:bak            = حالة القاعدة قبل آخر حفظ مباشرة
//    <key>:bak:slot:0..9  = 10 خانات دوّارة (نسخة كل ساعة، الأقدم يتكتب فوقه)
//    <key>:bak:slot:N:time = وقت أخذ النسخة (للتعرّف عليها وقت الاستعادة)
//  الاستعادة: من لوحة Upstash (Data Browser) انسخ قيمة النسخة فوق المفتاح الأساسي.
// =====================================================================
async function cloudBackup(baseKey, previousRaw) {
  if (!redis || !previousRaw || !previousRaw.trim()) return;
  try {
    JSON.parse(previousRaw); // لا ننسخ نسخة تالفة فوق نسخة سليمة
    await redis.set(baseKey + ":bak", previousRaw);
    const hourIdx = Math.floor(Date.now() / 3600000);
    // قفل يمنع تكرار النسخة الساعية داخل نفس الساعة، وينتهي لوحده بعد ساعتين
    const acquired = await redis.set(
      `${baseKey}:bak:lock:${hourIdx}`,
      "1",
      { nx: true, ex: 7200 }
    );
    if (acquired) {
      const slot = hourIdx % MAX_HOURLY_BACKUPS;
      await redis.set(`${baseKey}:bak:slot:${slot}`, previousRaw);
      await redis.set(
        `${baseKey}:bak:slot:${slot}:time`,
        new Date().toISOString()
      );
    }
  } catch (e) {
    console.log("[WARN] Cloud backup failed:", e.message);
  }
}

// =====================================================================
//  طبقة التخزين الموحدة (ملفات محليًا / Redis سحابيًا)
//  القاعدة الذهبية: فشل القراءة = throw. لا نرجع "قاعدة فاضية" أبدًا عند الخطأ،
//  عشان محدش يحفظ فوق بيانات ناقصة فيمسح الشغل كله.
//  القيمة null تعني فقط "لا توجد بيانات بعد" (أول تشغيل).
// =====================================================================
function ensureStorage() {
  if (IS_CLOUD && !redis) {
    throw new Error("Cloud storage (Upstash Redis) is not configured");
  }
}

async function readFileOrNull(file) {
  try {
    return await fs.promises.readFile(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function redisValueToString(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function readDataRaw() {
  if (IS_CLOUD) {
    ensureStorage();
    return redisValueToString(await redis.get(REDIS_KEY));
  }
  return readFileOrNull(DATA_FILE);
}

async function readProfilesRaw() {
  if (IS_CLOUD) {
    ensureStorage();
    const value = redisValueToString(await redis.get(REDIS_PROFILES_KEY));
    if (value !== null) return value;
    // أول تشغيل سحابي: نستخدم profiles.json المرفوع مع المشروع كبذرة ابتدائية
    return readFileOrNull(PROFILES_FILE);
  }
  return readFileOrNull(PROFILES_FILE);
}

// previousRaw = النص السابق (لو معروف) لاستخدامه في النسخة الاحتياطية السحابية
async function writeDataRaw(content, previousRaw) {
  if (IS_CLOUD) {
    ensureStorage();
    await cloudBackup(REDIS_KEY, previousRaw);
    await redis.set(REDIS_KEY, JSON.stringify(JSON.parse(content)));
    return;
  }
  backupBeforeWrite(DATA_FILE);
  atomicWriteFile(DATA_FILE, content);
}

async function writeProfilesRaw(content, previousRaw) {
  if (IS_CLOUD) {
    ensureStorage();
    await cloudBackup(REDIS_PROFILES_KEY, previousRaw);
    await redis.set(REDIS_PROFILES_KEY, JSON.stringify(JSON.parse(content)));
    return;
  }
  backupBeforeWrite(PROFILES_FILE);
  atomicWriteFile(PROFILES_FILE, content);
}

// ملف/قيمة تالفة: نحفظ نسخة منها للفحص ونرفض الكتابة بدل ما نمسحها.
async function quarantineData(raw) {
  try {
    if (IS_CLOUD) {
      if (redis && raw) {
        await redis.set(`${REDIS_KEY}:corrupt:${Date.now()}`, raw, {
          ex: 60 * 60 * 24 * 30,
        });
      }
    } else {
      fs.copyFileSync(
        DATA_FILE,
        path.join(__dirname, `data.corrupt-${Date.now()}.json`)
      );
    }
  } catch (e) {}
}

// =====================================================================
//  التجهيز عند التشغيل
// =====================================================================
if (!IS_CLOUD) {
  // التأكد من وجود الملفات المحلية
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ mahdar_index: [] }));
  }
  if (!fs.existsSync(PROFILES_FILE)) {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify({}, null, 4));
  }
  // نسخة احتياطية من الملفين عند كل تشغيل (لو سليمين)
  backupBeforeWrite(DATA_FILE);
  backupBeforeWrite(PROFILES_FILE);
}

// التشفير التلقائي للبيانات القديمة + نقل بيانات البروفايلات القديمة من ملف البيانات
async function migratePasswords() {
  try {
    const rawProfiles = await readProfilesRaw();
    const profilesData = JSON.parse(
      rawProfiles && rawProfiles.trim() ? rawProfiles : "{}"
    );
    let needsSave = false;

    const rawData = await readDataRaw();
    const legacyData = JSON.parse(rawData && rawData.trim() ? rawData : "{}");
    const profileKeys = [
      "niabat_employee_profiles_v1",
      "niabat_profiles_admin_v1",
    ];
    for (const key of profileKeys) {
      if (
        !Object.prototype.hasOwnProperty.call(profilesData, key) &&
        Object.prototype.hasOwnProperty.call(legacyData, key)
      ) {
        profilesData[key] = legacyData[key];
        needsSave = true;
      }
    }
    if (profilesData.niabat_employee_profiles_v1) {
      profilesData.niabat_employee_profiles_v1.forEach((p) => {
        if (p.password && p.password.length !== 64) {
          p.password = hashPassword(p.password);
          needsSave = true;
        }
      });
    }
    if (
      profilesData.niabat_profiles_admin_v1 &&
      profilesData.niabat_profiles_admin_v1.password
    ) {
      if (profilesData.niabat_profiles_admin_v1.password.length !== 64) {
        profilesData.niabat_profiles_admin_v1.password = hashPassword(
          profilesData.niabat_profiles_admin_v1.password
        );
        needsSave = true;
      }
    }
    if (needsSave) {
      await writeProfilesRaw(JSON.stringify(profilesData, null, 4), rawProfiles);
      console.log("[SECURITY] Passwords hashed.");
    }
  } catch (e) {
    console.log("[WARN] Error checking hashes:", e.message);
  }
}
enqueueRecordWrite(migratePasswords); // يعمل في الخلفية داخل الطابور

const stationTranslation = {
  "مصر القديمة": "Misr_El_Adima",
  "عين الصيرة": "Ain_El_Sira",
};
function getDisplaySafeKey(recordKey) {
  let displayKey = String(recordKey || "");
  let matched = false;
  for (const [arabicName, englishName] of Object.entries(stationTranslation)) {
    if (displayKey.includes(arabicName)) {
      displayKey = displayKey.replace(arabicName, englishName);
      matched = true;
      break;
    }
  }
  if (!matched)
    displayKey = displayKey
      .replace(/[^\x00-\x7F]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  return displayKey;
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

async function handleRequest(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Record-Key, X-Delete-Record"
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // فحص خفيف لحالة السيرفر من الصفحة الرئيسية، دون قراءة ملفات البيانات.
  if (req.url === "/api/health" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    return res.end(JSON.stringify({ status: "ok" }));
  }

  // === [تجهيز قراءة الختم (Token) من متصفح المستخدم] ===
  const cookies = req.headers.cookie
    ? req.headers.cookie.split(";").reduce((acc, c) => {
        const [k, v] = c.trim().split("=");
        acc[k] = v;
        return acc;
      }, {})
    : {};
  const userSession = verifyToken(cookies["niabat_token"]);

  // فحص صلاحية جلسة المستخدم من البوابة، بما في ذلك بعد إعادة تشغيل السيرفر.
  if (req.url === "/api/session" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    return res.end(JSON.stringify({ authenticated: !!userSession }));
  }

  // === [نقطة تسجيل الدخول لإصدار الختم] ===
  if (req.url === "/api/auth" && req.method === "POST") {
    const bodyChunks = [];
    req.on("data", (chunk) => bodyChunks.push(chunk));
    req.on("end", async () => {
      try {
        const creds = JSON.parse(Buffer.concat(bodyChunks).toString("utf8"));
        let profilesData;
        try {
          const rawProfiles = await readProfilesRaw();
          profilesData = JSON.parse(
            rawProfiles && rawProfiles.trim() ? rawProfiles : "{}"
          );
        } catch (readErr) {
          console.error("[ERROR] Cannot read profiles for login:", readErr.message);
          res.writeHead(500, JSON_HEADERS);
          return res.end(JSON.stringify({ success: false }));
        }
        let isValid = false;
        let payload = null;

        if (creds.isAdmin) {
          const admin = profilesData.niabat_profiles_admin_v1;
          if (admin && admin.password === creds.hash) {
            isValid = true;
            payload = { id: "admin", role: "super_admin" };
          }
        } else {
          const emps = profilesData.niabat_employee_profiles_v1 || [];
          const emp = emps.find(
            (e) =>
              e.id === creds.id && e.password === creds.hash && e.active !== false
          );
          if (emp) {
            isValid = true;
            payload = { id: emp.id, role: emp.accessRole };
          }
        }

        if (isValid && payload) {
          const token = createToken(payload);
          // وضع الختم في متصفح المستخدم بشكل محمي
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Set-Cookie": `niabat_token=${token}; Path=/; HttpOnly; SameSite=${COOKIE_SAMESITE}`,
          });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(401, JSON_HEADERS);
          res.end(JSON.stringify({ success: false }));
        }
      } catch (e) {
        res.writeHead(400);
        res.end();
      }
    });
    return;
  }

  // === [نقطة تسجيل الخروج لمسح الختم] ===
  if (req.url === "/api/logout" && req.method === "POST") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": `niabat_token=; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    });
    return res.end(JSON.stringify({ success: true }));
  }

  // === [جدار الحماية لقاعدة البيانات - API Protection] ===
  if (req.url === "/api/data" && req.method === "GET") {
    if (!userSession) {
      res.writeHead(403);
      return res.end(JSON.stringify({ mahdar_index: [] }));
    } // منع تحميل الداتابيز للخارج
    try {
      const raw = await enqueueRecordWrite(() => readDataRaw());
      res.writeHead(200, JSON_HEADERS);
      res.end(raw && raw.trim() ? raw : JSON.stringify({ mahdar_index: [] }));
    } catch (err) {
      console.error("[ERROR] Cannot read data:", err && err.message);
      res.writeHead(500);
      res.end("Read error");
    }
    return;
  }

  if (req.url === "/api/data" && req.method === "POST") {
    if (!userSession) {
      res.writeHead(403);
      return res.end("Access Denied: Missing Token");
    } // منع تعديل الداتابيز
    let recordKey = null;
    try {
      recordKey = req.headers["x-record-key"]
        ? decodeURIComponent(req.headers["x-record-key"])
        : null;
    } catch (e) {
      res.writeHead(400);
      return res.end("Invalid record key");
    }
    const isDeleteRequest = req.headers["x-delete-record"] === "true";
    const bodyChunks = [];
    req.on("data", (chunk) => bodyChunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(bodyChunks).toString("utf8");
      let incoming;
      try {
        incoming = JSON.parse(body);
        if (!incoming || Array.isArray(incoming) || typeof incoming !== "object")
          throw new Error("Not an object");
      } catch (e) {
        res.writeHead(400);
        return res.end("Invalid JSON");
      }

      if (recordKey) {
        enqueueRecordWrite(async () => {
          const fail = (code, msg) => {
            if (!res.headersSent) {
              res.writeHead(code);
              res.end(msg);
            }
          };
          try {
            // فشل القراءة = ممنوع الكتابة نهائيًا، حتى لا نبدأ من قاعدة فاضية ونمسح كل المحاضر.
            let currentRaw;
            try {
              currentRaw = await readDataRaw();
            } catch (readErr) {
              console.error(
                "[ERROR] Cannot read data, write refused:",
                readErr && readErr.message
              );
              return fail(500, "Read error - nothing was written");
            }
            let current;
            try {
              current =
                currentRaw && currentRaw.trim()
                  ? JSON.parse(currentRaw)
                  : { mahdar_index: [] };
              if (!current || Array.isArray(current) || typeof current !== "object")
                throw new Error("Not an object");
            } catch (parseErr) {
              await quarantineData(currentRaw);
              console.error("[ERROR] Stored data is corrupt, write refused.");
              return fail(500, "Data file corrupt - nothing was written");
            }

            if (isDeleteRequest) {
              delete current[recordKey];
            } else if (Object.prototype.hasOwnProperty.call(incoming, recordKey)) {
              // المصفوفات (مثل سجلات الإخطارات وروابطها) يجب استبدالها
              // كمصفوفة كاملة، لا دمجها بـ Object.assign الذي يحولها
              // إلى كائن ذي مفاتيح رقمية ويكسر القراءة اللاحقة.
              if (Array.isArray(incoming[recordKey])) {
                current[recordKey] = incoming[recordKey];
              } else if (
                incoming[recordKey] &&
                typeof incoming[recordKey] === "object" &&
                !Array.isArray(incoming[recordKey])
              ) {
                current[recordKey] = Object.assign(
                  {},
                  current[recordKey] || {},
                  incoming[recordKey]
                );
              } else {
                current[recordKey] = incoming[recordKey];
              }
            }
            if (recordKey.indexOf("mahdar_") === 0) {
              let index = Array.isArray(current.mahdar_index)
                ? current.mahdar_index
                : [];
              const existingPos = index.indexOf(recordKey);
              if (isDeleteRequest) {
                if (existingPos !== -1) index.splice(existingPos, 1);
              } else if (existingPos === -1) {
                index.push(recordKey);
              }
              current.mahdar_index = index;
            } else if (!Array.isArray(current.mahdar_index)) {
              current.mahdar_index = [];
            }

            await writeDataRaw(JSON.stringify(current, null, 4), currentRaw);
            console.log(
              `[SUCCESS] Record [${getDisplaySafeKey(recordKey)}] saved!`
            );
            if (!res.headersSent) {
              res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
              res.end("Saved");
            }
          } catch (e) {
            console.error("[ERROR] Record save failed:", e && e.message);
            fail(500, "Error");
          }
        });
        return;
      }

      // حفظ كامل بدون مفتاح سجل: تم التحقق أعلاه أن المحتوى JSON صالح وكائن،
      // وتؤخذ نسخة احتياطية تلقائيًا قبل الكتابة.
      enqueueRecordWrite(async () => {
        try {
          let previousRaw = null;
          if (IS_CLOUD) {
            try {
              previousRaw = await readDataRaw();
            } catch (e) {
              previousRaw = null;
            }
          }
          await writeDataRaw(body, previousRaw);
          if (!res.headersSent) {
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Saved");
          }
        } catch (err) {
          console.error("[ERROR] Full save failed:", err && err.message);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end("Error");
          }
        }
      });
    });
    return;
  }

  if (req.url === "/api/profiles" && req.method === "GET") {
    try {
      const raw = await enqueueRecordWrite(() => readProfilesRaw());
      res.writeHead(200, JSON_HEADERS);
      res.end(raw && raw.trim() ? raw : "{}");
    } catch (err) {
      console.error("[ERROR] Cannot read profiles:", err && err.message);
      res.writeHead(500, JSON_HEADERS);
      res.end("{}");
    }
    return;
  }

  if (req.url === "/api/profiles" && req.method === "POST") {
    const bodyChunks = [];
    req.on("data", (chunk) => bodyChunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(bodyChunks).toString("utf8");
      // كل الخطوات (قراءة + فحص + كتابة) تتم داخل الطابور، فلا يمكن لحفظتين
      // متزامنتين داخل نفس السيرفر أن تكتب إحداهما فوق الأخرى.
      enqueueRecordWrite(async () => {
        const send = (code, headers, text) => {
          if (res.headersSent) return;
          if (headers) res.writeHead(code, headers);
          else res.writeHead(code);
          res.end(text);
        };
        try {
          let data;
          try {
            data = await readProfilesRaw();
          } catch (e) {
            console.error("[ERROR] Cannot read profiles:", e && e.message);
            return send(
              500,
              JSON_HEADERS,
              JSON.stringify({
                success: false,
                error: "تعذرت قراءة ملف البروفايلات، لم يتم حفظ أي شيء",
              })
            );
          }
          let current;
          try {
            current = JSON.parse(data && data.trim() ? data : "{}");
          } catch (e) {
            return send(
              500,
              JSON_HEADERS,
              JSON.stringify({
                success: false,
                error: "ملف البروفايلات تالف، يرجى مراجعة السيرفر",
              })
            );
          }
          const hasAdmin =
            current.niabat_profiles_admin_v1 &&
            current.niabat_profiles_admin_v1.password;

          let parsed;
          try {
            parsed = JSON.parse(body);
            if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
              throw new Error("Invalid");
          } catch (e) {
            return send(400, null, "Invalid JSON");
          }

          // === [جدار الحماية للبروفايلات: السماح فقط للمديرين، مع استثناء الانطلاقة الأولى للبرنامج،
          // واستثناء "الخدمة الذاتية": موظف مسجّل دخوله يمكنه حفظ التغييرات على سجله الخاص فقط
          // (مثل تغيير كلمة مروره) دون المساس ببيانات المدير أو أي موظف آخر] ===
          let isAuthorized = false;
          if (!hasAdmin) {
            isAuthorized = true; // لا يوجد مدير بعد: الانطلاقة الأولى للبرنامج
          } else if (
            userSession &&
            (userSession.role === "super_admin" ||
              userSession.role === "account_admin")
          ) {
            isAuthorized = true; // مدير مسجّل دخوله: صلاحية كاملة
          } else if (userSession && userSession.id) {
            isAuthorized = isSelfServiceProfilesUpdate(
              current,
              parsed,
              userSession.id
            );
          }

          if (!isAuthorized) {
            return send(403, null, "Access Denied: High Privileges Required");
          }

          if (parsed.niabat_employee_profiles_v1) {
            parsed.niabat_employee_profiles_v1.forEach((p) => {
              if (p.password) p.password = hashPassword(p.password);
            });
          }
          if (
            parsed.niabat_profiles_admin_v1 &&
            parsed.niabat_profiles_admin_v1.password
          ) {
            parsed.niabat_profiles_admin_v1.password = hashPassword(
              parsed.niabat_profiles_admin_v1.password
            );
          }

          await writeProfilesRaw(JSON.stringify(parsed, null, 4), data);
          console.log("[SUCCESS] Profiles saved successfully.");
          send(200, null, "Saved");
        } catch (e) {
          console.error("[ERROR] Profiles save failed:", e && e.message);
          send(500, null, "Error");
        }
      });
    });
    return;
  }

  // مسار فتح ملف الوورد/النص مباشرة بالبرنامج الافتراضي — بس لو الطلب جاي من جهاز السيرفر نفسه؛
  // أي جهاز تاني في الشبكة (وكذلك النسخة السحابية) يرجعله success:false + isRemote:true عشان
  // الصفحة تلجأ لنسخ مسار الملف بدل ما تحاول تفتح حاجة هتفتح على شاشة السيرفر مش عنده
  if (req.url === "/api/open-word" && req.method === "POST") {
    if (IS_CLOUD) {
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ success: false, isRemote: true }));
    }
    const bodyChunks = [];
    req.on("data", (chunk) => bodyChunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(bodyChunks).toString("utf8");
      try {
        const data = JSON.parse(body);
        const requestedPath = data.filePath;
        if (!requestedPath) {
          res.writeHead(400, JSON_HEADERS);
          return res.end(
            JSON.stringify({ success: false, error: "لم يتم توفير مسار الملف" })
          );
        }
        if (!isRequestFromServerDevice(req)) {
          res.writeHead(200, JSON_HEADERS);
          return res.end(JSON.stringify({ success: false, isRemote: true }));
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
            const matchedFile = filesInDir.find(
              (f) => path.basename(f, path.extname(f)) === baseName
            );

            if (matchedFile) {
              // تم العثور على الملف بامتداد مختلف (تحديث المسار)
              fullPath = path.join(dirName, matchedFile);
            } else {
              res.writeHead(404, JSON_HEADERS);
              return res.end(
                JSON.stringify({
                  success: false,
                  error: "الملف غير موجود بأي امتداد",
                })
              );
            }
          } else {
            res.writeHead(404, JSON_HEADERS);
            return res.end(
              JSON.stringify({ success: false, error: "المجلد غير موجود" })
            );
          }
        }
        // استخدام أمر الويندوز لفتح الملف بالبرنامج المرتبط به في النظام
        const { exec } = require("child_process");
        const command = `start "" "${fullPath}"`;
        exec(command, (error) => {
          if (error) {
            console.error("[ERROR] Opening file:", error);
            res.writeHead(500, JSON_HEADERS);
            return res.end(
              JSON.stringify({
                success: false,
                error: "حدث خطأ أثناء فتح الملف من نظام التشغيل",
              })
            );
          }
          console.log(
            `[SUCCESS] File opened with its default app: ${fullPath}`
          );
          res.writeHead(200, JSON_HEADERS);
          res.end(JSON.stringify({ success: true }));
        });
      } catch (e) {
        console.error("[ERROR] Parsing open-word request:", e);
        res.writeHead(400, JSON_HEADERS);
        res.end(JSON.stringify({ success: false, error: "Invalid JSON" }));
      }
    });
    return;
  }

  // مسار فتح مجلد الملفات مباشرة — بس لو الطلب جاي من نفس جهاز السيرفر؛
  // أي جهاز تاني في الشبكة (وكذلك النسخة السحابية) يرجعله success:false + isRemote:true عشان
  // الصفحة تلجأ تلقائيًا لنسخ المسار الشبكي بدل ما تحاول تفتح حاجة مالهاش لازمة عنده
  if (req.url === "/api/open-folder" && req.method === "POST") {
    if (IS_CLOUD || !isRequestFromServerDevice(req)) {
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ success: false, isRemote: true }));
    }
    const { exec } = require("child_process");
    exec(`start "" "${FILES_DIR}"`, (error) => {
      if (error) {
        console.error("[ERROR] Opening folder:", error);
        res.writeHead(500, JSON_HEADERS);
        return res.end(
          JSON.stringify({ success: false, error: "حدث خطأ أثناء فتح المجلد" })
        );
      }
      console.log("[SUCCESS] Files folder opened on the server device.");
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ success: true, opened: true }));
    });
    return;
  }

  // === عرض ملفات البوابة ===
  let decodedUrl;
  try {
    decodedUrl = decodeURI(req.url);
  } catch (e) {
    res.writeHead(400);
    return res.end("Bad Request");
  }
  let filePath =
    req.url === "/"
      ? path.join(PUBLIC_DIR, "بوابه_نيابه_مرور_عين_الصيره.html")
      : path.join(PUBLIC_DIR, decodedUrl);
  let extname = String(path.extname(filePath)).toLowerCase();

  // === [جدار الحماية لمنع الدخول المباشر للروابط - Direct URL Access] ===
  if (
    extname === ".html" &&
    req.url !== "/" &&
    !decodedUrl.includes("بوابه_نيابه_مرور_عين_الصيره")
  ) {
    if (!userSession) {
      res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(` <html dir="rtl"> <head><title>وصول مرفوض</title><style>body{background:#0d1b2e;color:#f87171;font-family:sans-serif;text-align:center;padding-top:100px;}</style></head> <body> <h1 style="font-size:60px;margin-bottom:10px;">⛔</h1> <h1>وصول غير مصرح به!</h1> <p style="color:#c8d4e8;line-height:1.8;">لا يمكنك الدخول إلى أنظمة البوابة الفرعية بشكل مباشر.<br>الرجاء العودة وتسجيل الدخول من البوابة الرئيسية.</p> <a href="/" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#c9a84c;color:#0d1b2e;text-decoration:none;border-radius:10px;font-weight:bold;">العودة للبوابة الرئيسية</a> </body> </html> `);
    }

    // + [المنع الذكي: حتى لو الموظف مسجل دخول، لا تسمح بفتح النظام خارج إطار البوابة]
    // إذا كان الطلب مباشر للمتصفح وليس داخل iframe
    if (req.headers["sec-fetch-dest"] === "document") {
      res.writeHead(302, { Location: "/" }); // توجيه إجباري للبوابة الرئيسية
      return res.end();
    }
  }
  // ====================================================================

  let mimeTypes = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  let contentType = mimeTypes[extname] || "application/octet-stream";

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("File Not Found");
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content, "utf-8");
    }
  });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error("[ERROR] Unhandled request error:", err);
    try {
      if (!res.headersSent) res.writeHead(500);
      res.end("Server Error");
    } catch (e) {}
  });
});

// شبكة أمان: أي خطأ غير متوقع يتسجل في الشاشة ولا يوقّع السيرفر
process.on("uncaughtException", (err) => {
  console.error("[PREVENTED CRASH] Uncaught exception:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("[PREVENTED CRASH] Unhandled rejection:", err);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    IS_CLOUD
      ? `Cloud Server is running securely! Port: ${PORT}`
      : "Server is running and fully secured!"
  );
  console.log(`Port: ${PORT}`);
  console.log(`Mode: ${IS_CLOUD ? "CLOUD (Redis)" : "LOCAL (files)"}`);
});
