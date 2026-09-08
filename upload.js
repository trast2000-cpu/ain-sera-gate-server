const fs = require('fs');
const { Redis } = require('@upstash/redis');

// الاتصال بقاعدة بياناتك باستخدام الرابط والتوكن
const redis = new Redis({
  url: 'https://gentle-grouper-246580.upstash.io',
  token: 'gQAAAAAAA8M0AAIgcDJiNWNlMjg0Mjg1ODQ0ZTMwYTNhNmUwYzhmYmE5YmFmMw',
});

const DATA_FILE = './data.json';
const REDIS_KEY = 'ain_sera_database_records';

async function uploadOldData() {
  try {
    console.log('[1] جاري قراءة الملف المحلي data.json...');
    const rawData = fs.readFileSync(DATA_FILE, 'utf8');
    const parsedData = JSON.parse(rawData);

    console.log('[2] تم العثور على البيانات. جاري الرفع إلى السحابة...');
    
    // رفع البيانات إلى Upstash
    await redis.set(REDIS_KEY, JSON.stringify(parsedData));

    console.log('✅ تم رفع جميع المحاضر بنجاح! يمكنك الآن فتح البوابة على الإنترنت وستجد كل شيء.');
  } catch (error) {
    console.error('❌ حدث خطأ:', error);
  }
}

uploadOldData();
