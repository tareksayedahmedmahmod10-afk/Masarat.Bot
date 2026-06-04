'use strict';

// ============================================================
// MASARAT PRO — SERVER.JS v7.0
// WhatsApp Bot + Fleet State + Dispatch Router + Alert Push
// ✅ v7.0: نظام اشتراكات التنبيهات — الفروع تفعّل تنبيهات لسياراتهم
// ============================================================

const express = require('express');
const cors    = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode  = require('qrcode-terminal');
const QRCode  = require('qrcode');
const fs      = require('fs');
const path    = require('path');

let lastQR = '';
// ============================================================
// SECTION 1: CONFIGURATION
// ============================================================

const CONFIG = {
    PORT: 3000,
    DEBUG: true,
    SESSION_TIMEOUT_MS: 10 * 60 * 1000,

    TRIGGER_WORD: 'تتبع',
    SUPERVISOR_PHONE: '201121496272',

    // ✅ v7.0: ملف حفظ اشتراكات التنبيهات
    SUBSCRIPTIONS_FILE: path.join(__dirname, 'subscriptions.json'),

    BRANCHES: [
        { branchName: 'فرع عرعر',          phone: '966546640077', responsibleFor: ['فرع المساعدية'] },
        { branchName: 'فرع طريف',          phone: '966534840077', responsibleFor: ['فرع الروابي'] },
        { branchName: 'ثامر طريف',        phone: '966551427566', responsibleFor: ['فرع المصيف'] },
        { branchName: 'فرع سكاكا',         phone: '966552620077', responsibleFor: ['فرع المحمدية'] },
        { branchName: 'احمد جلال سكاكا',   phone: '966547803271', responsibleFor: ['فرع المحمدية'] },
        { branchName: 'فرع رفحاء',         phone: '966556780077', responsibleFor: ['فرع النموذجية'] },
        { branchName: 'عبدالحميد رفحاء',   phone: '966504151859', responsibleFor: ['فرع النموذجية'] },
        { branchName: 'فرع الثقبة',        phone: '966507602555', responsibleFor: ['فرع الثقبة', 'فرع الخبر - الثقبة'] },
        { branchName: 'فرع اليرموك',       phone: '966503714111', responsibleFor: ['فرع اليرموك'] },
        { branchName: 'فرع المصيف',        phone: '966506520077', responsibleFor: ['فرع الروابي'] },

        { branchName: 'Abdelrahman Nabil', phone: '201115876917', responsibleFor: ['*'] },
        { branchName: 'أ / احمد حجاج',    phone: '201018379746', responsibleFor: ['*'] },
        { branchName: 'أ/عمر',            phone: '966536630077', responsibleFor: ['*'] },

        { branchName: 'الإدارة المركزية — طارق', phone: '201121496272', responsibleFor: ['*'] },
    ],
};

// ============================================================
// ✅ v7.0: تعريف أنواع التنبيهات المتاحة للاشتراك
// هذه هي نفس أنواع التنبيهات الموجودة في السكريبت
// ============================================================

const ALERT_TYPES = [
    { key: 'stop',                    icon: '🔴', label: 'توقف المحرك' },
    { key: 'offline',                 icon: '📵', label: 'انقطاع الجهاز' },
    { key: 'speed',                   icon: '⚡', label: 'سرعة مفرطة' },
    { key: 'industrial',              icon: '🏭', label: 'منطقة صناعية' },
    { key: 'security',                icon: '🚔', label: 'منطقة أمنية' },
    { key: 'external',                icon: '🌍', label: 'خارج المملكة' },
    { key: 'towing',                  icon: '🚛', label: 'سحب محتمل' },
    { key: 'oil_overdue',             icon: '🛢',  label: 'تجاوز موعد الزيت' },
    { key: 'oil_warn',                icon: '⚠️', label: 'اقتراب موعد الزيت' },
    { key: 'stop_industrial',         icon: '🏭🔴', label: 'توقف بمنطقة صناعية' },
    { key: 'rented_stop_industrial',  icon: '🏭🔴', label: 'مؤجرة + توقف بصناعية' },
    { key: 'rented_offline',          icon: '📵🔴', label: 'مؤجرة + انقطاع 6 ساعات' },
    { key: 'available_savezone_exit', icon: '🟡', label: 'خروج من Save Zone' },
    { key: 'geofence_enter',          icon: '🗺️', label: 'دخول منطقة جغرافية' },
    { key: 'keyword_location',        icon: '📍', label: 'تنبيه موقع مخصص (كلمة مفتاحية)' },
];

// ============================================================
// LID MAP
// ============================================================
const LID_MAP = {
    '278472912064739': '201121496272',
    '223291189026841': '201115876917',
    '134488361300085': '966546640077',
    '224450729476289': '966534840077',
    '240960650915933': '966552620077',
    '271261678710878': '966556780077',
    '13546511450157':  '966547803271',
    '219657646641294': '966551427566',
    '147738301825137': '966536630077',
    '168938948325470': '201018379746',
    '189584285659262': '966504151859',
};

// ============================================================
// SECTION 2: STATE
// ============================================================

let isWhatsAppReady = false;

// ============================================================
// ✅ v7.0: SubscriptionManager — إدارة اشتراكات التنبيهات
// الهيكل: { "plateKey": { "alertType": ["phone1", "phone2", ...] } }
// مثال: { "abc123": { "stop": ["966552620077"], "speed": ["966552620077"] } }
// ============================================================

const SubscriptionManager = {
    _data: {},

    // تحميل البيانات من الملف عند البدء
    load() {
        try {
            if (fs.existsSync(CONFIG.SUBSCRIPTIONS_FILE)) {
                const raw = fs.readFileSync(CONFIG.SUBSCRIPTIONS_FILE, 'utf8');
                this._data = JSON.parse(raw);
                log(`✅ اشتراكات محملة: ${Object.keys(this._data).length} سيارة`);
            }
        } catch (err) {
            log('⚠️ خطأ في تحميل الاشتراكات:', err.message);
            this._data = {};
        }
    },

    // حفظ البيانات في الملف
    save() {
        try {
            fs.writeFileSync(CONFIG.SUBSCRIPTIONS_FILE, JSON.stringify(this._data, null, 2), 'utf8');
        } catch (err) {
            log('⚠️ خطأ في حفظ الاشتراكات:', err.message);
        }
    },

    // normalize مفتاح اللوحة
    _key(plate) { return normalize(plate); },

    // هل الفرع مشترك في تنبيه معين لسيارة معينة؟
    isSubscribed(plate, alertType, phone) {
        const k = this._key(plate);
        const phones = this._data[k]?.[alertType] || [];
        return phones.includes(cleanPhone(phone));
    },

    // تفعيل اشتراك
    subscribe(plate, alertType, phone) {
        const k = this._key(plate);
        if (!this._data[k]) this._data[k] = {};
        if (!this._data[k][alertType]) this._data[k][alertType] = [];
        const p = cleanPhone(phone);
        if (!this._data[k][alertType].includes(p)) {
            this._data[k][alertType].push(p);
            this.save();
            return true; // تم الاشتراك
        }
        return false; // كان مشتركاً مسبقاً
    },

    // إلغاء اشتراك
    unsubscribe(plate, alertType, phone) {
        const k = this._key(plate);
        const p = cleanPhone(phone);
        if (!this._data[k]?.[alertType]) return false;
        const idx = this._data[k][alertType].indexOf(p);
        if (idx !== -1) {
            this._data[k][alertType].splice(idx, 1);
            if (this._data[k][alertType].length === 0) delete this._data[k][alertType];
            if (Object.keys(this._data[k]).length === 0) delete this._data[k];
            this.save();
            return true;
        }
        return false;
    },

    // جلب كل التنبيهات الفعّالة لسيارة معينة وفرع معين
    getSubscriptionsForBranch(plate, phone) {
        const k = this._key(plate);
        const p = cleanPhone(phone);
        const result = [];
        const plateData = this._data[k] || {};
        for (const [alertType, phones] of Object.entries(plateData)) {
            if (phones.includes(p)) result.push(alertType);
        }
        return result;
    },

    // ✅ v7.1 إصلاح: جلب المشتركين بـ fuzzy match للوحة
    getSubscribersForAlert(plate, alertType) {
        const exactKey = this._key(plate);

        // 1) تطابق تام
        if (this._data[exactKey]?.[alertType]?.length > 0) {
            return this._data[exactKey][alertType];
        }

        // 2) fuzzy match — لو صيغة اللوحة مختلفة بين الاشتراك والتنبيه
        for (const storedKey of Object.keys(this._data)) {
            if (storedKey === exactKey) continue;
            if (storedKey.includes(exactKey) || exactKey.includes(storedKey)) {
                const phones = this._data[storedKey]?.[alertType];
                if (phones && phones.length > 0) {
                    log('🔍 fuzzy plate match: "' + exactKey + '" ↔ "' + storedKey + '"');
                    return phones;
                }
            }
            if (storedKey.length >= 5 && exactKey.length >= 5 &&
                storedKey.slice(-5) === exactKey.slice(-5)) {
                const phones = this._data[storedKey]?.[alertType];
                if (phones && phones.length > 0) {
                    log('🔍 suffix match: "' + exactKey + '" ↔ "' + storedKey + '"');
                    return phones;
                }
            }
        }
        return [];
    },

    // ✅ v7.1: إدارة الكلمات المفتاحية من الواتساب
    addKeyword(plate, keyword, phone) {
        const k  = this._key(plate);
        const kw = keyword.trim();
        if (!kw) return false;
        if (!this._data[k])              this._data[k] = {};
        if (!this._data[k]['_keywords']) this._data[k]['_keywords'] = [];
        const nkw    = normalize(kw);
        const exists = this._data[k]['_keywords'].some(w => normalize(w) === nkw);
        if (!exists) {
            this._data[k]['_keywords'].push(kw);
            if (!this._data[k]['_kw_owners']) this._data[k]['_kw_owners'] = {};
            this._data[k]['_kw_owners'][nkw] = cleanPhone(phone);
            this.save();
            return true;
        }
        return false;
    },

    removeKeyword(plate, keyword) {
        const k  = this._key(plate);
        const nk = normalize(keyword.trim());
        if (!this._data[k]?.['_keywords']) return false;
        const before = this._data[k]['_keywords'].length;
        this._data[k]['_keywords'] = this._data[k]['_keywords'].filter(w => normalize(w) !== nk);
        if (this._data[k]['_keywords'].length < before) {
            if (this._data[k]['_kw_owners']) delete this._data[k]['_kw_owners'][nk];
            this.save();
            return true;
        }
        return false;
    },

    getKeywords(plate) {
        const k = this._key(plate);
        return (this._data[k]?.['_keywords'] || []).filter(Boolean);
    },

    // جلب كل الكلمات لجميع السيارات — للسكريبت عبر /api/keywords
    getAllKeywords() {
        const result = {};
        for (const [plateKey, data] of Object.entries(this._data)) {
            const kws = (data['_keywords'] || []).filter(Boolean);
            if (kws.length > 0) result[plateKey] = kws;
        }
        return result;
    },

    // مسح كل اشتراكات فرع معين لسيارة معينة
    clearAllForBranch(plate, phone) {
        const k = this._key(plate);
        const p = cleanPhone(phone);
        if (!this._data[k]) return;
        for (const alertType of Object.keys(this._data[k])) {
            const idx = this._data[k][alertType].indexOf(p);
            if (idx !== -1) this._data[k][alertType].splice(idx, 1);
            if (this._data[k][alertType].length === 0) delete this._data[k][alertType];
        }
        if (Object.keys(this._data[k]).length === 0) delete this._data[k];
        this.save();
    },

    // إحصائيات
    stats() {
        const plates = Object.keys(this._data).length;
        let totalSubs = 0;
        for (const plateData of Object.values(this._data)) {
            for (const phones of Object.values(plateData)) {
                totalSubs += phones.length;
            }
        }
        return { plates, totalSubs };
    },
};

const FleetState = {
    vehicles:   new Map(),
    lastUpdate: null,

    update(vehiclesArray) {
        if (!Array.isArray(vehiclesArray)) return false;
        this.vehicles.clear();
        for (const v of vehiclesArray) {
            if (v.key) this.vehicles.set(v.key, v);
        }
        this.lastUpdate = new Date();
        log(`✅ Fleet synced: ${this.vehicles.size} vehicles`);
        return true;
    },

    find(plateInput) {
        const q = normalize(plateInput);
        if (this.vehicles.has(q)) return this.vehicles.get(q);
        for (const [k, v] of this.vehicles) {
            if (k.includes(q) || q.includes(k)) return v;
        }
        return null;
    },

    isReady() { return this.vehicles.size > 0; },
    size()    { return this.vehicles.size; },
};

const Sessions = {
    _store: {},
    _key: (phone) => cleanPhone(phone),

    get(phone) {
        const s = this._store[this._key(phone)];
        if (!s) return null;
        if (Date.now() - s.lastActivity > CONFIG.SESSION_TIMEOUT_MS) {
            delete this._store[this._key(phone)];
            return null;
        }
        return s;
    },

    create(phone, branch) {
        const k = this._key(phone);
        this._store[k] = { step: 'MENU', branch, lastActivity: Date.now() };
        return this._store[k];
    },

    setStep(phone, step, extra = {}) {
        const k = this._key(phone);
        if (this._store[k]) {
            this._store[k].step = step;
            this._store[k].lastActivity = Date.now();
            Object.assign(this._store[k], extra);
        }
    },

    destroy(phone)  { delete this._store[this._key(phone)]; },

    touch(phone) {
        const k = this._key(phone);
        if (this._store[k]) this._store[k].lastActivity = Date.now();
    },

    clearExpired() {
        const now = Date.now();
        for (const [k, s] of Object.entries(this._store)) {
            if (now - s.lastActivity > CONFIG.SESSION_TIMEOUT_MS) delete this._store[k];
        }
    },

    count() { return Object.keys(this._store).length; },
};

// ============================================================
// SECTION 3: UTILS
// ============================================================

function normalize(str) {
    if (!str || typeof str !== 'string') return '';
    let s = str.toString().trim();
    ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'].forEach((d, i) => { s = s.replaceAll(d, String(i)); });
    s = s.replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي');
    return s.replace(/[^a-zA-Z0-9\u0621-\u064A]/g,'').toLowerCase();
}

function cleanPhone(p) { return String(p || '').replace(/[^0-9]/g, ''); }

function normalizeBranch(str) {
    if (!str) return '';
    return str.trim()
        .replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي')
        .replace(/\s+/g,' ').toLowerCase();
}

function formatDate(d = new Date()) { return d.toLocaleDateString('en-GB'); }
function formatTime(d = new Date()) { return d.toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' }); }

function buildMapsLink(lat, lng, addr) {
    if (lat && lng && lat !== 0 && lng !== 0) return `https://www.google.com/maps?q=${lat},${lng}`;
    if (addr && addr !== '---') return `https://www.google.com/maps/search/${encodeURIComponent(addr)}`;
    return '';
}

function log(...args) { if (CONFIG.DEBUG) console.log('[MASARAT]', new Date().toLocaleTimeString('ar-SA'), ...args); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// SECTION 4: PERMISSIONS
// ============================================================

const Permissions = {

    extractPhone(rawFrom) {
        if (!rawFrom) return null;
        const str = String(rawFrom);

        if (str.endsWith('@lid')) {
            const lidNum = cleanPhone(str.replace(/@.+$/, ''));
            const mapped = LID_MAP[lidNum];
            if (mapped) {
                log(`✅ lid → ${lidNum} → ${mapped}`);
                return cleanPhone(mapped);
            }
            log(`⚠️ lid غير مربوط: ${lidNum}`);
            return null;
        }

        if (str.endsWith('@g.us') || str.includes('broadcast') || str.includes('status')) {
            log(`⏭ تجاهل جماعي/broadcast: ${str}`);
            return null;
        }

        const clean = cleanPhone(str.replace(/@.+$/, ''));
        if (!clean || clean.length < 7) return null;
        return clean;
    },

    findBranchByPhone(rawFrom) {
        if (!rawFrom) return null;
        const str = String(rawFrom);

        if (str.endsWith('@lid')) {
            const lidNum = cleanPhone(str.replace(/@.+$/, ''));
            const mapped = LID_MAP[lidNum];
            if (mapped) {
                const branch = CONFIG.BRANCHES.find(b => cleanPhone(b.phone) === cleanPhone(mapped));
                if (branch) {
                    log(`✅ lid مربوط: ${lidNum} → ${branch.branchName}`);
                    return branch;
                }
                log(`⚠️ lid مربوط لكن الرقم ${mapped} مش في BRANCHES`);
            } else {
                log(`🚫 lid غير مربوط: ${lidNum}`);
            }
            return null;
        }

        const phone = this.extractPhone(rawFrom);
        if (!phone) return null;

        const exact = CONFIG.BRANCHES.find(b => cleanPhone(b.phone) === phone);
        if (exact) return exact;

        const partial = CONFIG.BRANCHES.find(b => {
            const reg = cleanPhone(b.phone);
            return phone.endsWith(reg) || reg.endsWith(phone) || phone.slice(-9) === reg.slice(-9);
        });
        if (partial) return partial;

        log(`🚫 رقم غير مسجل: "${phone}"`);
        return null;
    },

    canAccessBranch(branch, excelBranch) {
        if (!branch) return false;
        if (branch.responsibleFor.includes('*')) return true;
        return branch.responsibleFor.some(b => normalizeBranch(b) === normalizeBranch(excelBranch));
    },

    getBranchesForExcelBranch(excelBranch) {
        return CONFIG.BRANCHES.filter(b =>
            b.responsibleFor.includes('*') ||
            b.responsibleFor.some(r => normalizeBranch(r) === normalizeBranch(excelBranch))
        );
    },
};

// ============================================================
// SECTION 5: REPORT BUILDER
// ============================================================

const ReportBuilder = {

    buildTrackingReport(vehicle, branchName, trackLink) {
        const live      = vehicle.live      || vehicle;
        const excelData = vehicle.excelData || { branch:'---', status:'---', type:'---' };
        const oilData   = vehicle.oilData   || { hasOil: false };

        let statusNote = '';
        const isTowing = (live.speed > 5) && (live.ignition === false);
        if (isTowing)            statusNote = '⚠️ سحب محتمل (المحرك مطفأ والسيارة تتحرك)';
        else if (live.isOffline) statusNote = `📵 الجهاز فاصل منذ ${live.offlineTime || '---'}`;
        else if (live.speed > 0) statusNote = `🚀 تتحرك — ${live.speed} كم/س`;
        else                     statusNote = '🛑 متوقفة بالموقع المذكور';
        if (live.isIndustrial && live.zoneName) statusNote += ` — داخل ${live.zoneName}`;

        const locationStr = live.isExternal
            ? `🌍 دولي: ${live.countryName} — ${live.addr}`
            : live.isSafeZone
                ? `✅ Save Zone: ${live.zoneName || ''}`
                : (live.addr || '---');

        const mapsLink = buildMapsLink(live.lat, live.lng, live.addr);

        let oilLine = '';
        if (oilData.hasOil) {
            const abs = Math.abs(oilData.oilRemaining).toLocaleString('en');
            const due = (oilData.oilDueKM || 0).toLocaleString('en');
            if (oilData.isOilOverdue)   oilLine = `⛔ تجاوز +${abs} كم (صلاحية: ${due} كم)`;
            else if (oilData.isOilWarn) oilLine = `⚠️ متبقي ${abs} كم (صلاحية: ${due} كم)`;
        }

        const lines = [
            `🚨 بلاغ تتبع ومتابعة 🚨`, ``,
            `📍 الفرع: ${excelData.branch}`,
            `📑 حالة العقد: مفتوح ( ${excelData.status} )`, ``,
            `👤 اسم العميل: —`,
            `🔢 رقم العقد: —`, ``,
            `🚗 نوع السيارة: ${excelData.type}`,
            `💳 لوحة السيارة: ${live.plate}`,
            `📏 الكيلومتر الحالي: ${(live.liveKM || 0).toLocaleString('en')} كم`,
        ];
        if (oilLine) lines.push(`🛢 صيانة الزيت: ${oilLine}`);
        lines.push(``);
        lines.push(`🗺️ بيانات الموقع: ${locationStr}`);
        if (mapsLink) lines.push(`📍 خريطة: ${mapsLink}`);

        const finalTrackLink = (trackLink && trackLink.startsWith('http'))
            ? trackLink
            : (live.lat && live.lng && live.lat !== 0 && live.lng !== 0)
                ? `https://www.google.com/maps?q=${live.lat},${live.lng}`
                : '';
        if (finalTrackLink) lines.push(`🔗 تتبع مباشر: ${finalTrackLink}`);
        lines.push(`📝 الحالة: ${statusNote}`);
        lines.push(`📅 ${formatDate()} — ${formatTime()}`);
        if (branchName) lines.push(`🏢 أعدّه: ${branchName}`);

        return lines.join('\n');
    },

    buildOilAlert(vehicle, branchName) {
        const live      = vehicle.live      || vehicle;
        const excelData = vehicle.excelData || { branch:'---', status:'---' };
        const oilData   = vehicle.oilData   || { hasOil: false };

        if (!oilData.hasOil) {
            return `ℹ️ لا تتوفر بيانات صيانة زيت لهذه السيارة.\n💳 اللوحة: ${live.plate}`;
        }

        const abs = Math.abs(oilData.oilRemaining).toLocaleString('en');
        const due = (oilData.oilDueKM || 0).toLocaleString('en');
        const statusLine = oilData.isOilOverdue
            ? `⛔ تجاوزت موعد تغيير الزيت بـ +${abs} كم`
            : oilData.isOilWarn
                ? `⚠️ متبقي ${abs} كم لموعد تغيير الزيت`
                : `✅ متبقي ${abs} كم — الزيت على ما يرام`;

        const isRented = ['مؤجرة','المؤجره','مؤجر'].some(r => (excelData.status || '').includes(r));
        const notes = isRented
            ? 'السيارة تحتاج تغيير زيت\nبرجاء التواصل مع العميل للتأكد ومتابعة غيار الزيت'
            : 'السيارة تحتاج تغيير زيت\nبرجاء التأكد ومتابعة غيار الزيت';

        return [
            `📢 تنبيه تغيير زيت`, ``,
            `🔹 رقم اللوحة: ${live.plate}`,
            `🔹 العداد الحالي: ${(live.liveKM || 0).toLocaleString('en')} كم`,
            `🔹 صلاحية الزيت: ${due} كم`,
            `🔹 الفرع: ${excelData.branch} (${excelData.status})`,
            `🔹 الحالة: ${statusLine}`,
            `🔹 معد البلاغ: ${branchName}`,
            ``,
            `🔹 الملاحظات:`,
            notes,
        ].join('\n');
    },

    buildAutomationAlert(alertData) {
        const { type, icon, plate, msg, addr, time } = alertData;
        const timeStr = time
            ? new Date(time).toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' })
            : formatTime();

        const lines = [
            `${icon || '🚨'} *تنبيه مسارات — ${plate}*`,
            ``,
            `📌 النوع: ${type || '---'}`,
            `📝 التفاصيل: ${msg}`,
        ];
        if (addr && addr !== '---') lines.push(`📍 الموقع: ${addr}`);
        lines.push(`🕐 الوقت: ${timeStr}`);
        lines.push(`📅 ${formatDate()}`);
        return lines.join('\n');
    },
};

// ============================================================
// SECTION 6: BOT MESSAGES
// ============================================================

const BotMsg = {

    menu: (branchName) => [
        `🚗 *خدمة تتبع مسارات*`,
        `🏢 ${branchName}`,
        ``,
        `اختر الخدمة بإرسال الرقم:`,
        ``,
        `*1* — تتبع سيارة 📍`,
        `*2* — موعد تغيير زيت 🛢`,
        `*3* — التواصل مع موظف التتبع 📞`,
        `*4* — إدارة تنبيهات السيارة 🔔`,
        ``,
        `_اكتب "إلغاء" في أي وقت للخروج_`,
    ].join('\n'),

    askPlate: (serviceType) => {
        const labels = {
            tracking:     'التتبع',
            oil:          'الزيت',
            alerts_setup: 'إعداد التنبيهات',
        };
        const label = labels[serviceType] || serviceType;
        return `🔍 أرسل *رقم لوحة السيارة* للاستعلام عن ${label}:\n\n_اكتب "إلغاء" للرجوع للقائمة_`;
    },

    // ✅ v7.0: قائمة اختيار التنبيهات لسيارة معينة
    alertsMenu: (plate, activeAlerts) => {
        const lines = [
            `🔔 *إدارة تنبيهات اللوحة: ${plate}*`,
            ``,
            `اختر رقم التنبيه لتفعيله أو إيقافه:`,
            `_(التنبيهات الفعّالة مُعلَّمة بـ ✅)_`,
            ``,
        ];

        ALERT_TYPES.forEach((t, i) => {
            const isActive = activeAlerts.includes(t.key);
            const status   = isActive ? '✅' : '⬜';
            lines.push(`*${i + 1}* ${status} ${t.icon} ${t.label}`);
        });

        lines.push(``);
        lines.push(`*${ALERT_TYPES.length + 1}* ❌ إيقاف كل التنبيهات لهذه السيارة`);
        lines.push(`*0* 🔙 رجوع للقائمة الرئيسية`);
        lines.push(``);
        lines.push(`_أرسل الرقم لتفعيل/إيقاف التنبيه_`);

        return lines.join('\n');
    },

    alertToggled: (alertType, isNowActive, plate) => {
        const info = ALERT_TYPES.find(t => t.key === alertType);
        const label = info ? `${info.icon} ${info.label}` : alertType;
        if (isNowActive) {
            return `✅ تم تفعيل تنبيه *${label}*\nللوحة: *${plate}*\n\nستصلك رسالة على هذا الرقم فور اكتشاف هذا الحدث.`;
        } else {
            return `❎ تم إيقاف تنبيه *${label}*\nللوحة: *${plate}*`;
        }
    },

    allAlertsCleared: (plate) =>
        `🗑 تم إيقاف *جميع التنبيهات* للوحة: *${plate}*`,

    plateNotFound: (plate) =>
        `❌ اللوحة "*${plate}*" غير موجودة في نظام التتبع.\n\nتأكد من الرقم وأعد المحاولة\nأو اكتب *إلغاء* للرجوع للقائمة`,

    branchNotAllowed: (excelBranch) =>
        `⛔ عذراً، هذه السيارة تتبع *"${excelBranch}"*\nغير مصرح لك بالوصول إليها.\n\nأرسل *تتبع* للرجوع للقائمة`,

    noFleetData: () =>
        `⚠️ لا تتوفر بيانات من نظام التتبع الآن.\nتأكد من أن مسارات مفتوح ومتصل بالسيرفر.`,

    contactSupervisor: () =>
        `📞 *موظف التتبع — طارق سيد*\n\nللتواصل المباشر:\n📱 اضغط هنا: https://wa.me/201121496272\n\nأو اتصل على: 201121496272+`,

    cancel: () =>
        `✅ تم الإلغاء.\n\nأرسل *تتبع* للعودة للقائمة.`,

    invalidChoice: () =>
        `❓ اختيار غير صحيح.\n\nأرسل *1* أو *2* أو *3* أو *4*\nأو اكتب *إلغاء* للخروج`,

    invalidAlertChoice: (maxNum) =>
        `❓ اختيار غير صحيح.\n\nأرسل رقماً من 1 إلى ${maxNum}\nأو *0* للرجوع\nأو *إلغاء* للخروج`,
};

// ============================================================
// SECTION 7: WHATSAPP CLIENT
// ============================================================

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
});

client.on('qr', (qr) => {
    lastQR = qr;
    console.log('\n📌 امسح QR Code للاتصال بـ WhatsApp:\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ WhatsApp متصل وجاهز!');
    isWhatsAppReady = true;
});

client.on('auth_failure', (msg) => console.error('❌ WhatsApp auth failure:', msg));

client.on('disconnected', (reason) => {
    console.log('❌ WhatsApp انقطع:', reason);
    isWhatsAppReady = false;
});

// ============================================================
// SECTION 8: BOT HANDLER
// ============================================================

client.on('message', async (msg) => {
    try {
        if (msg.type !== 'chat') return;

        const text    = msg.body?.trim() || '';

        // ✅ v7.1: لو الرسالة من نفسنا (fromMe)، نتحقق هل هي من رقم المشرف
        // لما المشرف يكتب لنفسه في Saved Messages أو لأي شات، msg.from بيبقى رقمه
        // ولكن msg.fromMe = true، فنسمح له فقط ونتجاهل باقي الرسايل اللي fromMe
        let rawFrom = msg.from;

        if (msg.fromMe) {
            // نستخرج الرقم من msg.to (الرقم اللي بعته له) أو msg.from
            // لما بتكتب لنفسك: msg.from = رقمك@c.us، msg.to = رقمك@c.us
            const selfPhone = cleanPhone(CONFIG.SUPERVISOR_PHONE);
            const fromPhone = cleanPhone((msg.from || '').replace(/@.+$/, ''));
            const toPhone   = cleanPhone((msg.to   || '').replace(/@.+$/, ''));

            // نتأكد إن الرسالة دي من رقم المشرف أو لرقمه (Saved Messages)
            const isSupervisorSelf =
                fromPhone === selfPhone ||
                toPhone   === selfPhone ||
                fromPhone.slice(-9) === selfPhone.slice(-9) ||
                toPhone.slice(-9)   === selfPhone.slice(-9);

            if (!isSupervisorSelf) return; // رسالة بعتها لحد تاني — تجاهل

            // ✅ في حالة Saved Messages، msg.from بيبقى رقمه نفسه — تمام
            // لو msg.from مش رقمه، نحطه يدوياً
            if (fromPhone !== selfPhone && fromPhone.slice(-9) !== selfPhone.slice(-9)) {
                rawFrom = `${selfPhone}@c.us`;
            }

            log(`📨 [fromMe — مشرف] من: "${rawFrom}" | نص: "${text}"`);
        } else {
            log(`📨 من: "${rawFrom}" | نص: "${text}"`);
        }

        Sessions.clearExpired();

        const normText  = normalize(text);
        const isCancel  = ['الغاء','إلغاء','cancel','خروج','stop','رجوع','back'].includes(normText);
        const isTrigger = normText === normalize(CONFIG.TRIGGER_WORD);

        const branch = Permissions.findBranchByPhone(rawFrom);
        if (!branch) {
            const extracted = Permissions.extractPhone(rawFrom);
            log(`🚫 رقم غير مسجل — raw: ${rawFrom} | extracted: ${extracted || 'null'}`);
            return;
        }

        const sessionKey = Permissions.extractPhone(rawFrom);
        if (!sessionKey) {
            log(`⏭ تجاهل — مش قادر يستخرج رقم: ${rawFrom}`);
            return;
        }

        log(`✅ معروف: ${branch.branchName} | key: ${sessionKey}`);

        let session = Sessions.get(sessionKey);

        // إلغاء في أي وقت
        if (isCancel) {
            Sessions.destroy(sessionKey);
            await msg.reply(BotMsg.cancel());
            return;
        }

        // مفيش جلسة → لازم كلمة التفعيل
        if (!session) {
            if (!isTrigger) {
                log(`⏸ ${sessionKey} — تجاهل (لم يرسل كلمة التفعيل)`);
                return;
            }
            session = Sessions.create(sessionKey, branch);
            await msg.reply(BotMsg.menu(branch.branchName));
            return;
        }

        Sessions.touch(sessionKey);

        // إعادة القائمة لو أرسل "تتبع" وهو في جلسة
        if (isTrigger) {
            Sessions.setStep(sessionKey, 'MENU');
            await msg.reply(BotMsg.menu(branch.branchName));
            return;
        }

        // ── القائمة الرئيسية ──────────────────────────────────
        if (session.step === 'MENU') {
            const choice = normText.replace(/[^1234]/g, '');

            if (choice === '1') {
                Sessions.setStep(sessionKey, 'TRACKING_PLATE');
                await msg.reply(BotMsg.askPlate('tracking'));

            } else if (choice === '2') {
                Sessions.setStep(sessionKey, 'OIL_PLATE');
                await msg.reply(BotMsg.askPlate('oil'));

            } else if (choice === '3') {
                await msg.reply(BotMsg.contactSupervisor());
                Sessions.destroy(sessionKey);

            } else if (choice === '4') {
                // ✅ v7.0: إدارة تنبيهات السيارة
                Sessions.setStep(sessionKey, 'ALERTS_PLATE');
                await msg.reply(BotMsg.askPlate('alerts_setup'));

            } else {
                await msg.reply(BotMsg.invalidChoice());
            }
            return;
        }

        // ── لوحة التتبع ──────────────────────────────────────
        if (session.step === 'TRACKING_PLATE') {
            if (!FleetState.isReady()) {
                await msg.reply(BotMsg.noFleetData());
                Sessions.destroy(sessionKey);
                return;
            }

            const vehicle = FleetState.find(text);
            if (!vehicle) {
                await msg.reply(BotMsg.plateNotFound(text));
                return;
            }

            const excelData = vehicle.excelData || { branch:'---', status:'---', type:'---' };
            if (!Permissions.canAccessBranch(branch, excelData.branch)) {
                await msg.reply(BotMsg.branchNotAllowed(excelData.branch));
                Sessions.destroy(sessionKey);
                return;
            }

            const report = ReportBuilder.buildTrackingReport(vehicle, branch.branchName, vehicle.shareLink || '');
            await msg.reply(report);
            Sessions.destroy(sessionKey);
            log(`✅ تقرير تتبع — لوحة: ${vehicle.live?.plate || vehicle.plate} — فرع: ${branch.branchName}`);
            return;
        }

        // ── لوحة الزيت ───────────────────────────────────────
        if (session.step === 'OIL_PLATE') {
            if (!FleetState.isReady()) {
                await msg.reply(BotMsg.noFleetData());
                Sessions.destroy(sessionKey);
                return;
            }

            const vehicle = FleetState.find(text);
            if (!vehicle) {
                await msg.reply(BotMsg.plateNotFound(text));
                return;
            }

            const excelData = vehicle.excelData || { branch:'---', status:'---', type:'---' };
            if (!Permissions.canAccessBranch(branch, excelData.branch)) {
                await msg.reply(BotMsg.branchNotAllowed(excelData.branch));
                Sessions.destroy(sessionKey);
                return;
            }

            const oilMsg = ReportBuilder.buildOilAlert(vehicle, branch.branchName);
            await msg.reply(oilMsg);
            Sessions.destroy(sessionKey);
            log(`✅ تنبيه زيت — لوحة: ${vehicle.live?.plate || vehicle.plate} — فرع: ${branch.branchName}`);
            return;
        }

        // ============================================================
        // ✅ v7.0: مرحلة إدخال اللوحة لإعداد التنبيهات
        // ============================================================
        if (session.step === 'ALERTS_PLATE') {
            if (!FleetState.isReady()) {
                await msg.reply(BotMsg.noFleetData());
                Sessions.destroy(sessionKey);
                return;
            }

            const vehicle = FleetState.find(text);
            if (!vehicle) {
                await msg.reply(BotMsg.plateNotFound(text));
                return;
            }

            const live      = vehicle.live      || vehicle;
            const excelData = vehicle.excelData || { branch:'---' };

            if (!Permissions.canAccessBranch(branch, excelData.branch)) {
                await msg.reply(BotMsg.branchNotAllowed(excelData.branch));
                Sessions.destroy(sessionKey);
                return;
            }

            // حفظ اللوحة في الجلسة والانتقال لخطوة اختيار التنبيه
            const plateKey = normalize(live.plate || text);
            const activeAlerts = SubscriptionManager.getSubscriptionsForBranch(plateKey, sessionKey);

            Sessions.setStep(sessionKey, 'ALERTS_MENU', {
                alertsPlate:    live.plate || text,
                alertsPlateKey: plateKey,
            });

            await msg.reply(BotMsg.alertsMenu(live.plate || text, activeAlerts));
            log(`✅ إدارة تنبيهات — لوحة: ${live.plate} — فرع: ${branch.branchName}`);
            return;
        }

        // ============================================================
        // ✅ v7.0: مرحلة اختيار التنبيه (تفعيل / إيقاف)
        // ============================================================
        if (session.step === 'ALERTS_MENU') {
            const plate    = session.alertsPlate    || '---';
            const plateKey = session.alertsPlateKey || '';
            const choiceRaw = normText.replace(/[^0-9]/g, '');
            const choice    = parseInt(choiceRaw, 10);

            // 0 = رجوع للقائمة
            if (choice === 0) {
                Sessions.setStep(sessionKey, 'MENU');
                await msg.reply(BotMsg.menu(branch.branchName));
                return;
            }

            // إيقاف كل التنبيهات
            if (choice === ALERT_TYPES.length + 1) {
                SubscriptionManager.clearAllForBranch(plateKey, sessionKey);
                await msg.reply(BotMsg.allAlertsCleared(plate));
                // نرجعه لقائمة التنبيهات نفسها بعد الإيقاف
                const activeAlerts = SubscriptionManager.getSubscriptionsForBranch(plateKey, sessionKey);
                await sleep(800);
                await msg.reply(BotMsg.alertsMenu(plate, activeAlerts));
                return;
            }

            // اختيار تنبيه معين (1 → ALERT_TYPES.length)
            if (choice >= 1 && choice <= ALERT_TYPES.length) {
                const alertType = ALERT_TYPES[choice - 1].key;

                // ✅ v7.1: تنبيه الكلمات المفتاحية — يطلب من الفرع يكتب الكلمة
                if (alertType === 'keyword_location') {
                    const existingKws = SubscriptionManager.getKeywords(plateKey);
                    const kwListText  = existingKws.length > 0
                        ? '\n\n📋 *الكلمات الحالية:*\n' + existingKws.map((k, i) => `${i+1}. ${k}`).join('\n')
                        : '\n\n_(لا توجد كلمات مضافة بعد)_';
                    Sessions.setStep(sessionKey, 'KEYWORD_INPUT', {
                        alertsPlate:    plate,
                        alertsPlateKey: plateKey,
                    });
                    await msg.reply(
                        `📍 *تنبيه الموقع المخصص — ${plate}*` +
                        kwListText +
                        '\n\n─────────────────' +
                        '\nأرسل الكلمة أو اسم المكان اللي تريد التنبيه عند وصول السيارة إليه:' +
                        '\n_مثال: الرياض_' +
                        '\n_أو: شارع العليا_' +
                        '\n\n*حذف كلمة:* أرسل: حذف الكلمة' +
                        '\n_مثال: حذف الرياض_' +
                        '\n\nأو *إلغاء* للرجوع'
                    );
                    return;
                }

                // باقي أنواع التنبيهات — toggle عادي
                const wasActive = SubscriptionManager.isSubscribed(plateKey, alertType, sessionKey);
                let isNowActive;
                if (wasActive) {
                    SubscriptionManager.unsubscribe(plateKey, alertType, sessionKey);
                    isNowActive = false;
                } else {
                    SubscriptionManager.subscribe(plateKey, alertType, sessionKey);
                    isNowActive = true;
                }

                await msg.reply(BotMsg.alertToggled(alertType, isNowActive, plate));
                log(`✅ تنبيه ${isNowActive ? 'مفعّل' : 'موقوف'}: ${alertType} — لوحة: ${plate} — فرع: ${branch.branchName}`);

                await sleep(800);
                const updatedAlerts = SubscriptionManager.getSubscriptionsForBranch(plateKey, sessionKey);
                await msg.reply(BotMsg.alertsMenu(plate, updatedAlerts));
                return;
            }

            // اختيار غير صحيح
            await msg.reply(BotMsg.invalidAlertChoice(ALERT_TYPES.length + 1));
            return;
        }

        // ============================================================
        // ✅ v7.1: مرحلة إدخال الكلمة المفتاحية
        // ============================================================
        if (session.step === 'KEYWORD_INPUT') {
            const plate    = session.alertsPlate    || '---';
            const plateKey = session.alertsPlateKey || '';

            // حذف كلمة: "حذف الرياض" أو "حذف شارع العليا"
            const deleteMatch = text.match(/^حذف\s+(.+)$/);
            if (deleteMatch) {
                const kwToDelete = deleteMatch[1].trim();
                const removed = SubscriptionManager.removeKeyword(plateKey, kwToDelete);
                if (removed) {
                    await msg.reply(`🗑 تم حذف الكلمة: *${kwToDelete}*\n\nالكلمات المتبقية: ${SubscriptionManager.getKeywords(plateKey).join('، ') || 'لا يوجد'}`);
                } else {
                    await msg.reply(`❌ الكلمة "${kwToDelete}" غير موجودة في القائمة`);
                }
                await sleep(800);
                // نرجع لقائمة الكلمات
                const kws = SubscriptionManager.getKeywords(plateKey);
                const kwListText = kws.length > 0
                    ? '\n\n📋 *الكلمات الحالية:*\n' + kws.map((k, i) => `${i+1}. ${k}`).join('\n')
                    : '\n\n_(لا توجد كلمات)_';
                await msg.reply(
                    `📍 *كلمات تنبيه الموقع — ${plate}*` + kwListText +
                    '\n\nأرسل كلمة جديدة لإضافتها، أو *إلغاء* للرجوع'
                );
                return;
            }

            // إضافة كلمة جديدة
            const keyword = text.trim();
            if (!keyword || keyword.length < 2) {
                await msg.reply('❓ الكلمة قصيرة جداً، أرسل كلمة صحيحة أو *إلغاء* للرجوع');
                return;
            }

            const added = SubscriptionManager.addKeyword(plateKey, keyword, sessionKey);

            // تأكيد الإضافة وتفعيل الاشتراك في keyword_location تلقائياً
            SubscriptionManager.subscribe(plateKey, 'keyword_location', sessionKey);

            const allKws = SubscriptionManager.getKeywords(plateKey);
            const kwListDisplay = allKws.map((k, i) => `${i+1}. ${k}`).join('\n');

            if (added) {
                await msg.reply(
                    `✅ تم إضافة الكلمة: *${keyword}*\n` +
                    `للوحة: *${plate}*\n\n` +
                    `📋 *جميع كلمات التنبيه:*\n${kwListDisplay}\n\n` +
                    `_ستصلك رسالة فور دخول السيارة لأي منطقة يحتوي عنوانها على هذه الكلمات_\n\n` +
                    `أرسل كلمة أخرى لإضافتها، أو *إلغاء* للرجوع`
                );
            } else {
                await msg.reply(
                    `⚠️ الكلمة *${keyword}* موجودة مسبقاً\n\n` +
                    `📋 *الكلمات الحالية:*\n${kwListDisplay}\n\n` +
                    `أرسل كلمة أخرى لإضافتها، أو *إلغاء* للرجوع`
                );
            }

            log(`✅ كلمة مفتاحية ${added ? 'أضيفت' : 'موجودة'}: "${keyword}" — لوحة: ${plate} — فرع: ${branch.branchName}`);
            return;
        }

        // fallback
        Sessions.destroy(sessionKey);
        await msg.reply(BotMsg.cancel());

    } catch (err) {
        log('❌ خطأ في معالجة الرسالة:', err.message);
        console.error(err);
    }
});

// ============================================================
// SECTION 9: EXPRESS API
// ============================================================

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ── GET /qr ──────────────────────────────────────────────
app.get('/qr', (req, res) => {
    res.sendFile(path.join(__dirname, 'qr.html'));
});

app.get('/qr-image', async (req, res) => {
    if (!lastQR) return res.status(404).send('no QR');

    const imgData = await QRCode.toDataURL(lastQR, {
        width: 500,
        margin: 3,
        color: { dark: '#000000', light: '#ffffff' },
    });

    const base64 = imgData.replace('data:image/png;base64,', '');
    const img = Buffer.from(base64, 'base64');

    res.setHeader('Content-Type', 'image/png');
    res.send(img);
});

// ── GET / ────────────────────────────────────────────────
app.get('/', (req, res) => {
    const stats = SubscriptionManager.stats();
    res.json({
        status:      'ok',
        version:     'v7.0',
        whatsapp:    isWhatsAppReady ? 'connected' : 'disconnected',
        fleet:       FleetState.size(),
        lastUpdate:  FleetState.lastUpdate,
        sessions:    Sessions.count(),
        subscriptions: stats,
    });
});
// ── POST /api/sync ───────────────────────────────────────
app.post('/api/sync', (req, res) => {
    const { vehicles } = req.body;
    if (!Array.isArray(vehicles))
        return res.status(400).json({ success: false, error: 'vehicles must be an array' });
    const ok = FleetState.update(vehicles);
    res.json({ success: ok, count: FleetState.size() });
});

// ============================================================
// ✅ v7.0: POST /api/alert
// الآن يرسل للمشرف + كل الفروع المشتركة في هذا التنبيه لهذه السيارة
// ============================================================
app.post('/api/alert', async (req, res) => {
    if (!isWhatsAppReady)
        return res.json({ success: false, error: 'WhatsApp not ready' });

    const { type, icon, plate, msg, addr, time, targetBranch } = req.body;
    if (!plate || !msg)
        return res.status(400).json({ success: false, error: 'plate and msg are required' });

    const message = ReportBuilder.buildAutomationAlert({ type, icon, plate, msg, addr, time });

    const recipients = new Set();

    // 1️⃣ دايماً يوصل للمشرف
    recipients.add(cleanPhone(CONFIG.SUPERVISOR_PHONE));

    // 2️⃣ لو في فرع محدد (targetBranch) ابعت ليه
    if (targetBranch) {
        const targetBranches = Permissions.getBranchesForExcelBranch(targetBranch);
        for (const b of targetBranches) {
            const p = cleanPhone(b.phone);
            if (p && p !== cleanPhone(CONFIG.SUPERVISOR_PHONE)) recipients.add(p);
        }
    }

    // 3️⃣ ✅ v7.0: كل الفروع المشتركة في هذا التنبيه لهذه السيارة
    const plateKey = normalize(plate);
    const subscribers = SubscriptionManager.getSubscribersForAlert(plateKey, type);
    for (const subPhone of subscribers) {
        if (subPhone) recipients.add(cleanPhone(subPhone));
    }

    const results = [];
    for (const phone of recipients) {
        if (!phone) continue;
        try {
            await client.sendMessage(`${phone}@c.us`, message);
            results.push({ phone, success: true });
            log(`✅ Alert → ${phone} | ${plate} | ${type}`);
        } catch (err) {
            results.push({ phone, success: false, error: err.message });
            log(`❌ Alert failed → ${phone}: ${err.message}`);
        }
        await sleep(400);
    }

    const successCount = results.filter(r => r.success).length;
    res.json({ success: successCount > 0, sent: successCount, total: results.length, results });
});

// ============================================================
// ✅ v7.0: POST /api/alert/batch
// نفس الفكرة — كل تنبيه يوصل لمشتركيه + المشرف
// ============================================================
app.post('/api/alert/batch', async (req, res) => {
    if (!isWhatsAppReady)
        return res.json({ success: false, error: 'WhatsApp not ready' });

    const { alerts } = req.body;
    if (!Array.isArray(alerts) || alerts.length === 0)
        return res.status(400).json({ success: false, error: 'alerts must be a non-empty array' });

    const supervisorPhone = cleanPhone(CONFIG.SUPERVISOR_PHONE);
    const allResults = [];

    for (const alertData of alerts) {
        const { type, icon, plate, msg, addr, time, targetBranch } = alertData;
        if (!plate || !msg) {
            allResults.push({ plate: plate || '?', success: false, error: 'missing plate or msg' });
            continue;
        }

        const message = ReportBuilder.buildAutomationAlert(alertData);
        const recipients = new Set();

        // 1️⃣ المشرف دايماً
        recipients.add(supervisorPhone);

        // 2️⃣ الفرع المحدد (targetBranch)
        if (targetBranch) {
            const targetBranches = Permissions.getBranchesForExcelBranch(targetBranch);
            for (const b of targetBranches) {
                const p = cleanPhone(b.phone);
                if (p && p !== supervisorPhone) recipients.add(p);
            }
        }

        // 3️⃣ ✅ v7.0: المشتركون في هذا التنبيه
        const plateKey = normalize(plate);
        const subscribers = SubscriptionManager.getSubscribersForAlert(plateKey, type);
        for (const subPhone of subscribers) {
            if (subPhone) recipients.add(cleanPhone(subPhone));
        }

        for (const phone of recipients) {
            if (!phone) continue;
            try {
                await client.sendMessage(`${phone}@c.us`, message);
                allResults.push({ plate, phone, success: true });
                log(`✅ Batch alert → ${phone} | ${plate} | ${type}`);
            } catch (err) {
                allResults.push({ plate, phone, success: false, error: err.message });
                log(`❌ Batch alert failed → ${phone} | ${plate}: ${err.message}`);
            }
            await sleep(500);
        }
    }

    const successCount = allResults.filter(r => r.success).length;
    res.json({ success: successCount > 0, sent: successCount, total: allResults.length });
});

// ── POST /api/dispatch ───────────────────────────────────
app.post('/api/dispatch', async (req, res) => {
    if (!isWhatsAppReady)
        return res.json({ success: false, error: 'WhatsApp not ready yet' });

    const { car, branch, type, employee } = req.body;
    if (!car || !branch)
        return res.status(400).json({ success: false, error: 'car and branch are required' });

    const authorizedBranches = Permissions.getBranchesForExcelBranch(branch);
    if (authorizedBranches.length === 0)
        return res.json({ success: false, error: 'no_authorized_branches', branch, dispatched: 0 });

    const typeLabel = { repair:'🔧 صيانة', move:'🚚 نقل', report:'📋 بلاغ' }[type] || `📌 ${type || '---'}`;
    const message = [
        `🚗 *طلب جديد*`, ``,
        `🚘 السيارة: *${car    || '---'}*`,
        `🏢 الفرع:   *${branch || '---'}*`,
        `🔧 النوع:   *${typeLabel}*`,
        `👤 الموظف:  *${employee || '---'}*`,
        `🕐 ${new Date().toLocaleString('ar-SA', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit' })}`,
    ].join('\n');

    const results = [];
    for (const b of authorizedBranches) {
        const phoneNum = cleanPhone(b.phone);
        if (!phoneNum) continue;
        try {
            await client.sendMessage(`${phoneNum}@c.us`, message);
            results.push({ branch: b.branchName, success: true });
            log(`✅ Dispatch → ${b.branchName}`);
        } catch (err) {
            results.push({ branch: b.branchName, success: false, error: err.message });
            log(`❌ Dispatch failed → ${b.branchName}: ${err.message}`);
        }
        await sleep(500);
    }

    const successCount = results.filter(r => r.success).length;
    res.json({ success: successCount > 0, dispatched: successCount, total: results.length, results });
});

// ── GET /api/status ──────────────────────────────────────
app.get('/api/status', (req, res) => {
    const stats = SubscriptionManager.stats();
    res.json({
        whatsapp:      isWhatsAppReady,
        fleet:         FleetState.size(),
        lastUpdate:    FleetState.lastUpdate,
        sessions:      Sessions.count(),
        branches:      CONFIG.BRANCHES.length,
        subscriptions: stats,
    });
});

// ── GET /api/vehicle/:plate ──────────────────────────────
app.get('/api/vehicle/:plate', (req, res) => {
    const v = FleetState.find(req.params.plate);
    if (!v) return res.json({ found: false });
    res.json({ found: true, data: v });
});

// ── GET /api/subscriptions ───────────────────────────────
// عرض كل الاشتراكات الحالية
app.get('/api/subscriptions', (req, res) => {
    res.json({
        success: true,
        data:    SubscriptionManager._data,
        stats:   SubscriptionManager.stats(),
    });
});

// ── GET /api/subscriptions/:plate ───────────────────────
// عرض اشتراكات سيارة معينة
app.get('/api/subscriptions/:plate', (req, res) => {
    const plateKey  = normalize(req.params.plate);
    const plateData = SubscriptionManager._data[plateKey] || {};
    res.json({ plate: req.params.plate, plateKey, subscriptions: plateData });
});

// ── DELETE /api/subscriptions/:plate ────────────────────
// مسح كل اشتراكات سيارة معينة (للإدارة)
app.delete('/api/subscriptions/:plate', (req, res) => {
    const plateKey = normalize(req.params.plate);
    delete SubscriptionManager._data[plateKey];
    SubscriptionManager.save();
    res.json({ success: true, message: `تم مسح اشتراكات اللوحة: ${req.params.plate}` });
});

// ── GET /api/keywords ─────────────────────────────────────
// ✅ v7.1: السكريبت يجيب الكلمات المفتاحية المضافة من الواتساب
// { "plateKey": ["الرياض", "العليا", ...], ... }
app.get('/api/keywords', (req, res) => {
    const allKws = SubscriptionManager.getAllKeywords();
    res.json({ success: true, keywords: allKws, count: Object.keys(allKws).length });
});

// ── GET /api/keywords/:plate ──────────────────────────────
// كلمات سيارة معينة
app.get('/api/keywords/:plate', (req, res) => {
    const kws = SubscriptionManager.getKeywords(req.params.plate);
    res.json({ plate: req.params.plate, keywords: kws });
});

// ── GET /api/debug/phone/:rawPhone ───────────────────────
app.get('/api/debug/phone/:rawPhone', (req, res) => {
    const raw    = req.params.rawPhone + '@c.us';
    const branch = Permissions.findBranchByPhone(raw);
    res.json({
        input:      req.params.rawPhone,
        extracted:  Permissions.extractPhone(raw),
        found:      !!branch,
        branchName: branch?.branchName || null,
        registered: CONFIG.BRANCHES.map(b => ({ name: b.branchName, phone: cleanPhone(b.phone) })),
    });
});

// ── GET /api/debug/lid/:lidNum ────────────────────────────
app.get('/api/debug/lid/:lidNum', (req, res) => {
    const lidNum = cleanPhone(req.params.lidNum);
    const mapped = LID_MAP[lidNum];
    const branch = mapped
        ? CONFIG.BRANCHES.find(b => cleanPhone(b.phone) === cleanPhone(mapped))
        : null;
    res.json({
        lid:         lidNum,
        mappedPhone: mapped || null,
        found:       !!branch,
        branchName:  branch?.branchName || null,
        allLIDs:     Object.keys(LID_MAP),
    });
});

// ── POST /request ────────────────────────────────────────
app.post('/request', async (req, res) => {
    if (!isWhatsAppReady)
        return res.json({ success: false, error: 'WhatsApp not ready yet' });
    try {
        const phone = cleanPhone(req.body.phone || CONFIG.SUPERVISOR_PHONE);
        await client.sendMessage(`${phone}@c.us`, req.body.message || 'test');
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ============================================================
// SECTION 10: START
// ============================================================

// تحميل الاشتراكات المحفوظة عند البدء
SubscriptionManager.load();

client.initialize();

app.listen(CONFIG.PORT, () => {
    const stats = SubscriptionManager.stats();
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║   MASARAT PRO — SERVER v7.0                  ║');
    console.log(`║   http://localhost:${CONFIG.PORT}                      ║`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  endpoints:                                  ║');
    console.log('║   POST /api/sync             مزامنة أسطول   ║');
    console.log('║   POST /api/alert            تنبيه ذكي      ║');
    console.log('║   POST /api/alert/batch      دفعة تنبيهات   ║');
    console.log('║   POST /api/dispatch         طلب للفروع     ║');
    console.log('║   GET  /api/status           حالة السيرفر   ║');
    console.log('║   GET  /api/subscriptions    كل الاشتراكات  ║');
    console.log('║   GET  /api/subscriptions/:p اشتراكات لوحة  ║');
    console.log('║   DEL  /api/subscriptions/:p مسح اشتراكات   ║');
    console.log('║   GET  /api/keywords         كل الكلمات     ║');
    console.log('║   GET  /api/keywords/:plate  كلمات لوحة     ║');
    console.log('║   GET  /api/debug/phone/:n   اختبار رقم     ║');
    console.log('║   GET  /api/debug/lid/:n     اختبار LID     ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
    console.log(`📲 المشرف: +${CONFIG.SUPERVISOR_PHONE}`);
    console.log(`🔔 اشتراكات محملة: ${stats.plates} سيارة — ${stats.totalSubs} اشتراك`);
    console.log('');
    console.log('📋 الفروع المسجلة:');
    CONFIG.BRANCHES.forEach(b => {
        const marker = cleanPhone(b.phone) === cleanPhone(CONFIG.SUPERVISOR_PHONE) ? ' ⭐' : '';
        console.log(`   • ${b.branchName} — ${b.phone} — ${b.responsibleFor.join(', ')}${marker}`);
    });
    console.log('');
    console.log('🔔 أنواع التنبيهات المتاحة للاشتراك:');
    ALERT_TYPES.forEach((t, i) => {
        console.log(`   ${i + 1}. ${t.icon} ${t.label} (${t.key})`);
    });
    console.log('');
    console.log('⏳ انتظار اتصال WhatsApp...');
    console.log('');
});