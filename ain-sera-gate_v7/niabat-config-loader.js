(function () {
  'use strict';
  var CFG_KEY = 'niabat_config';

  /* 1. تحميل الإعدادات من الذاكرة أو من الملف */
  async function loadConfig() {
    // محاولة القراءة من الذاكرة أولاً
    var saved = localStorage.getItem(CFG_KEY);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }

    // إذا لم توجد في الذاكرة، حملها فوراً من ملف JSON
    try {
      var response = await fetch('config_niabat.json');
      if (response.ok) {
        var data = await response.json();
        localStorage.setItem(CFG_KEY, JSON.stringify(data));
        return data;
      }
    } catch (e) { console.warn("تعذر تحميل ملف الإعدادات الخارجي"); }

    return null; // لا يوجد شيء
  }

  /* 2. دالة تحديث شاملة لكل عناصر الصفحة */
  async function applyAll() {
    var cfg = await loadConfig();
    if (!cfg) return;

    // تحديث اسم النيابة
    var nameEls = document.querySelectorAll('[data-config="prosecution-name"]');
    nameEls.forEach(el => el.textContent = cfg.prosecutionName);

    // تحديث قوائم الوكلاء والأقسام (بناءً على الـ ID أو data-config)
    updateSelect('select#prosecutor, select[data-config="agent-select"]', cfg.agents);
    updateSelect('select#dept, select#police_station, select[data-config="stations-select"]', cfg.stations);
  }

  /* دالة مساعدة لتحديث القوائم */
  function updateSelect(selector, items) {
    var selects = document.querySelectorAll(selector);
    selects.forEach(select => {
      var currentVal = select.value;
      // لا نمسح الخيار الأول إذا كان هو "اختر"
      var first = select.options[0];
      select.innerHTML = '';
      if (first) select.appendChild(first);
      
      items.forEach(item => {
        var opt = document.createElement('option');
        opt.value = item; opt.textContent = item;
        select.appendChild(opt);
      });
      // إضافة خيار "أخرى" دائماً
      var other = document.createElement('option');
      other.value = 'other'; other.textContent = 'أخرى...';
      select.appendChild(other);
      
      if (currentVal) select.value = currentVal;
    });
  }

  // التنفيذ عند تحميل أي صفحة
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAll);
  } else {
    applyAll();
  }
})();