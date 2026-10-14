/**
 * Al Noor Gaming Studio — الإعجابات والتعليقات وعدّاد اللعب
 * الصقي هذا الكود في Apps Script داخل جدول Google، ثم شغّلي الدالة setup مرة واحدة، ثم انشري كتطبيق ويب.
 * الخطوات كاملة في SETUP-ar.md
 *
 * الموافقة على التعليقات: افتحي ورقة Comments وضعي علامة ✔ في عمود approved.
 * الحذف: احذفي الصف.
 */
var STATS = 'Stats';
var COMMENTS = 'Comments';
var MAX_NAME = 30, MAX_TEXT = 500, MAX_SHOWN = 100;
var CACHE_TTL = 120; // ثوانٍ: تسريع قراءة الإحصاءات والتعليقات (يُمسح الكاش تلقائياً عند أي تغيير)

function cacheGet_(k) { try { var v = CacheService.getScriptCache().get(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function cachePut_(k, o) { try { CacheService.getScriptCache().put(k, JSON.stringify(o), CACHE_TTL); } catch (e) {} }
function cacheClear_(games) {
  try {
    var keys = ['stats'];
    for (var i = 0; i < (games || []).length; i++) keys.push('cm:' + games[i]);
    CacheService.getScriptCache().removeAll(keys);
  } catch (e) {}
}

/**
 * مفتاح المشرف: كلمة سر طويلة (16 حرفاً فأكثر) تكتبينها هنا مرة واحدة.
 * تُستخدم في صفحة admin.html للموافقة على التعليقات وحذفها. إن تُرك فارغاً تُعطَّل إدارة التعليقات من الصفحة
 * (وتبقى الإدارة من الجدول ممكنة). لا تشاركيه مع أحد.
 */
var ADMIN_KEY = '';

function setup() {
  var ss = SpreadsheetApp.getActive();
  var st = ss.getSheetByName(STATS) || ss.insertSheet(STATS);
  if (st.getLastRow() === 0) st.appendRow(['game', 'likes', 'plays']);
  st.setFrozenRows(1);
  var cm = ss.getSheetByName(COMMENTS) || ss.insertSheet(COMMENTS);
  if (cm.getLastRow() === 0) cm.appendRow(['id', 'game', 'name', 'text', 'time', 'approved']);
  cm.getRange('A:E').setNumberFormat('@');          // نص عادي (يمنع تحويل النص إلى صيغة)
  cm.setFrozenRows(1);
  cm.setColumnWidth(4, 420);
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'stats') {
    var c = cacheGet_('stats');
    if (!c) { c = stats_(); cachePut_('stats', c); }
    return out_({ stats: c });
  }
  if (p.action === 'comments') {
    var g = String(p.game || ''), k = 'cm:' + g, cl = cacheGet_(k);
    if (!cl) { cl = comments_(g); cachePut_(k, cl); }
    return out_({ comments: cl });
  }
  return out_({ ok: true });
}

function doPost(e) {
  var d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return out_({ error: 'bad request' }); }
  if (d && typeof d.action === 'string' && d.action.indexOf('admin_') === 0) return out_(admin_(d));
  if (!d || !/^[A-Za-z0-9_-]{1,60}$/.test(String(d.game || ''))) return out_({ error: 'bad game' });
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (d.action === 'like') { var r1 = bump_(d.game, 'likes', d.delta > 0 ? 1 : -1); cacheClear_([d.game]); return out_(r1); }
    if (d.action === 'play') { var r2 = bump_(d.game, 'plays', 1); cacheClear_([d.game]); return out_(r2); }
    if (d.action === 'comment') return out_(addComment_(d));
    return out_({ error: 'unknown action' });
  } finally {
    lock.releaseLock();
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_(name) {
  var s = SpreadsheetApp.getActive().getSheetByName(name);
  if (!s) { setup(); s = SpreadsheetApp.getActive().getSheetByName(name); }
  return s;
}

function isApproved_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function stats_() {
  var out = {}, i;
  var st = sheet_(STATS), n = st.getLastRow();
  if (n > 1) {
    var rows = st.getRange(2, 1, n - 1, 3).getValues();
    for (i = 0; i < rows.length; i++) out[rows[i][0]] = { likes: Number(rows[i][1]) || 0, plays: Number(rows[i][2]) || 0, comments: 0 };
  }
  var cm = sheet_(COMMENTS), m = cm.getLastRow();
  if (m > 1) {
    var cs = cm.getRange(2, 1, m - 1, 6).getValues();
    for (i = 0; i < cs.length; i++) {
      if (!isApproved_(cs[i][5])) continue;
      var g = cs[i][1];
      if (!out[g]) out[g] = { likes: 0, plays: 0, comments: 0 };
      out[g].comments++;
    }
  }
  return out;
}

function comments_(game) {
  var cm = sheet_(COMMENTS), m = cm.getLastRow(), list = [];
  if (m < 2) return list;
  var rows = cm.getRange(2, 1, m - 1, 6).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][1] === game && isApproved_(rows[i][5]))
      list.push({ id: rows[i][0], name: rows[i][2], text: rows[i][3], time: rows[i][4] });
  }
  list.sort(function (a, b) { return a.time < b.time ? 1 : -1; });
  return list.slice(0, MAX_SHOWN);
}

function bump_(game, field, delta) {
  var st = sheet_(STATS), n = st.getLastRow(), row = -1, i;
  if (n > 1) {
    var ids = st.getRange(2, 1, n - 1, 1).getValues();
    for (i = 0; i < ids.length; i++) if (ids[i][0] === game) { row = i + 2; break; }
  }
  if (row < 0) { st.appendRow([game, 0, 0]); row = st.getLastRow(); }
  var rng = st.getRange(row, 1, 1, 3), v = rng.getValues()[0], idx = field === 'likes' ? 1 : 2;
  v[idx] = Math.max(0, (Number(v[idx]) || 0) + delta);
  rng.setValues([v]);
  return { ok: true, likes: Number(v[1]) || 0, plays: Number(v[2]) || 0 };
}

function clean_(s, max) {
  s = String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u202A-\u202E]/g, '').trim();
  if (s.length > max) s = s.slice(0, max);
  if (/^[=+\-@]/.test(s)) s = ' ' + s;               // حماية من حقن الصيغ في الجدول
  return s;
}

function addComment_(d) {
  var name = clean_(d.name, MAX_NAME) || 'زائر';
  var text = clean_(d.text, MAX_TEXT);
  if (text.length < 2) return { error: 'empty' };
  var cm = sheet_(COMMENTS);
  var id = Utilities.getUuid();
  cm.appendRow([id, d.game, name, text, new Date().toISOString(), false]);
  cm.getRange(cm.getLastRow(), 6).insertCheckboxes();   // خانة موافقة ✔
  return { ok: true, pending: true, id: id };
}

/* ---------- أوامر المشرف (تتطلب ADMIN_KEY) ---------- */
function admin_(d) {
  if (!ADMIN_KEY || String(ADMIN_KEY).length < 12) return { error: 'disabled' };
  if (String(d.key || '') !== ADMIN_KEY) { Utilities.sleep(1000); return { error: 'unauthorized' }; }
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var cm = sheet_(COMMENTS), m = cm.getLastRow(), i;
    if (d.action === 'admin_list') {
      var out = [];
      if (m > 1) {
        var rows = cm.getRange(2, 1, m - 1, 6).getValues();
        for (i = 0; i < rows.length; i++)
          out.push({ id: rows[i][0], game: rows[i][1], name: rows[i][2], text: rows[i][3], time: rows[i][4], approved: isApproved_(rows[i][5]) });
      }
      out.sort(function (a, b) { return a.time < b.time ? 1 : -1; });
      return { ok: true, comments: out.slice(0, 500) };
    }
    var ids = m > 1 ? cm.getRange(2, 1, m - 1, 1).getValues() : [];
    var rowOf = function (id) { for (var k = 0; k < ids.length; k++) if (ids[k][0] === id) return k + 2; return -1; };
    if (d.action === 'admin_approve') {
      var list = Array.isArray(d.ids) ? d.ids : [d.id], n = 0, touched = [];
      for (i = 0; i < list.length; i++) {
        var r = rowOf(String(list[i]));
        if (r > 0) { cm.getRange(r, 6).setValue(d.approved !== false); touched.push(String(cm.getRange(r, 2).getValue())); n++; }
      }
      cacheClear_(touched);
      return { ok: true, changed: n };
    }
    if (d.action === 'admin_delete') {
      var row = rowOf(String(d.id));
      if (row < 0) return { error: 'not found' };
      var gdel = String(cm.getRange(row, 2).getValue());
      cm.deleteRow(row);
      cacheClear_([gdel]);
      return { ok: true };
    }
    return { error: 'unknown action' };
  } finally {
    lock.releaseLock();
  }
}
