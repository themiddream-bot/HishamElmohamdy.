import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === 'production';
if (production && !process.env.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD must be set in production.');
const adminPassword = process.env.ADMIN_PASSWORD || 'Abdelrahman123';
const dbPath = process.env.DATABASE_PATH || join(root, 'data', 'platform.sqlite');
mkdirSync(join(root, 'data'), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', grade TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student', balance INTEGER NOT NULL DEFAULT 0, avatar TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS lessons (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, price INTEGER NOT NULL, duration TEXT NOT NULL, level TEXT NOT NULL, icon TEXT NOT NULL, tone TEXT NOT NULL, video_url TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS purchases (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE, purchased_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id, lesson_id));
CREATE TABLE IF NOT EXISTS recharge_codes (code TEXT PRIMARY KEY, amount INTEGER NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id), used_by INTEGER REFERENCES users(id) ON DELETE SET NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
try { db.exec("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''"); } catch {}
db.exec(`CREATE TABLE IF NOT EXISTS lesson_progress (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE, watched_seconds INTEGER NOT NULL DEFAULT 0, duration_seconds INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,lesson_id));
UPDATE lessons SET price=50;`);

const initialLessons = [
  ['html', 'أساسيات HTML و CSS', 'ابدأ ببناء صفحات الويب وتعلّم تنسيقها خطوة بخطوة.', 50, '٤٥ دقيقة', 'مبتدئ', 'fa-brands fa-html5', 'purple', 'https://www.youtube.com/watch?v=M7lc1UVf-VE'],
  ['javascript', 'مدخل إلى JavaScript', 'أضف التفاعل لمواقعك مع أساسيات لغة JavaScript.', 50, '٦٠ دقيقة', 'مبتدئ', 'fa-brands fa-js', 'teal', 'https://www.youtube.com/watch?v=M7lc1UVf-VE'],
  ['projects', 'مشروعك الأول', 'طبّق ما تعلمته وأنشئ صفحة ويب عملية من الصفر.', 50, '٧٥ دقيقة', 'تطبيقي', 'fa-solid fa-laptop-code', 'blue', 'https://www.youtube.com/watch?v=M7lc1UVf-VE']
];
const insertLesson = db.prepare('INSERT OR IGNORE INTO lessons (id,title,description,price,duration,level,icon,tone,video_url) VALUES (?,?,?,?,?,?,?,?,?)');
for (const lesson of initialLessons) insertLesson.run(...lesson);
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('abdelrahmanyasser');
if (!adminExists) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(adminPassword, salt, 64).toString('hex');
  db.prepare('INSERT INTO users (username,email,name,password_hash,role) VALUES (?,?,?,?,?)').run('abdelrahmanyasser', 'admin@hisham.local', 'Abdelrahman Yasser', `${salt}:${hash}`, 'admin');
}

const sessions = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
const publicFiles = new Set(['index.html','app.js','styles.css','account.css','admin.css','progress.css']);
function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(data));
}
function userView(user) {
  return user ? { id: user.id, username: user.username, email: user.email, name: user.name, phone: user.phone, grade: user.grade, role: user.role, balance: user.balance, avatar: user.avatar || '' } : null;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 2500000) reject(new Error('Request too large')); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function currentUser(req) {
  const token = req.headers.cookie?.match(/(?:^|; )sid=([a-f\d]+)/)?.[1];
  const id = token && sessions.get(token);
  return id ? db.prepare('SELECT id,username,email,name,phone,grade,role,balance,avatar FROM users WHERE id=?').get(id) : null;
}
function requireUser(user, res) {
  if (!user) { json(res, 401, { error: 'سجل الدخول أولاً.' }); return false; }
  return true;
}
function requireAdmin(user, res) {
  if (!user || user.role !== 'admin') { json(res, user ? 403 : 401, { error: 'هذه الصفحة مخصصة للأدمن.' }); return false; }
  return true;
}
function sessionCookie(token, clear = false) {
  return `sid=${clear ? '' : token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${clear ? 0 : 604800}${production ? '; Secure' : ''}`;
}
function validVideoLink(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && ['youtube.com','www.youtube.com','m.youtube.com','youtu.be','www.youtu.be','vimeo.com','www.vimeo.com','player.vimeo.com'].includes(url.hostname); } catch { return false; }
}

async function handleApi(req, res, url) {
  const route = url.pathname;
  const body = ['GET','HEAD'].includes(req.method) ? {} : await readBody(req);
  let user = currentUser(req);
  if (route === '/api/bootstrap' && req.method === 'GET') {
    const lessons = db.prepare('SELECT id,title,description,price,duration,level,icon,tone,video_url AS video FROM lessons ORDER BY rowid').all();
    const progress = user ? db.prepare('SELECT lesson_id,watched_seconds,duration_seconds FROM lesson_progress WHERE user_id=?').all(user.id) : [];
    return json(res, 200, { lessons, user: userView(user), purchased: user ? db.prepare('SELECT lesson_id FROM purchases WHERE user_id=?').all(user.id).map(row => row.lesson_id) : [], progress });
  }
  if (route === '/api/register' && req.method === 'POST') {
    const username = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = String(body.name || '').trim();
    if (!username || !name || password.length < 8 || username === 'abdelrahmanyasser') return json(res, 400, { error: 'أكمل بيانات التسجيل، واجعل كلمة المرور ٨ أحرف على الأقل.' });
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    try {
      const result = db.prepare('INSERT INTO users (username,email,name,phone,grade,password_hash) VALUES (?,?,?,?,?,?)').run(username, username.includes('@') ? username : `${username}@student.local`, name, String(body.phone || '').trim(), String(body.grade || '').trim(), `${salt}:${hash}`);
      user = db.prepare('SELECT id,username,email,name,phone,grade,role,balance,avatar FROM users WHERE id=?').get(Number(result.lastInsertRowid));
      const token = randomBytes(32).toString('hex'); sessions.set(token, user.id);
      return json(res, 201, { user: userView(user) }, { 'Set-Cookie': sessionCookie(token) });
    } catch { return json(res, 409, { error: 'اسم المستخدم أو البريد مسجل بالفعل.' }); }
  }
  if (route === '/api/login' && req.method === 'POST') {
    const login = String(body.login || '').trim().toLowerCase();
    const account = db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(login, login);
    if (!account || !verifyPassword(String(body.password || ''), account.password_hash)) return json(res, 401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    const token = randomBytes(32).toString('hex'); sessions.set(token, account.id);
    return json(res, 200, { user: userView(account) }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (route === '/api/logout' && req.method === 'POST') {
    const token = req.headers.cookie?.match(/(?:^|; )sid=([a-f\d]+)/)?.[1]; if (token) sessions.delete(token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', true) });
  }
  if (route === '/api/profile' && req.method === 'PUT') {
    if (!requireUser(user,res)) return;
    const name = String(body.name || '').trim(); if (!name) return json(res,400,{error:'اكتب اسم الطالب.'});
    const avatar=String(body.avatar||''); if(avatar && (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)||avatar.length>1800000))return json(res,400,{error:'الصورة غير صالحة أو حجمها كبير. اختر صورة أقل من ١ ميجابايت.'});
    db.prepare('UPDATE users SET name=?,phone=?,grade=?,avatar=? WHERE id=?').run(name,String(body.phone||'').trim(),String(body.grade||'').trim(),avatar,user.id);
    return json(res,200,{user:userView(db.prepare('SELECT id,username,email,name,phone,grade,role,balance,avatar FROM users WHERE id=?').get(user.id))});
  }
  if(route==='/api/progress'&&req.method==='POST'){
    if(!requireUser(user,res))return;
    const lessonId=String(body.lessonId||''); const watched=Math.floor(Number(body.watchedSeconds)); const duration=Math.floor(Number(body.durationSeconds));
    if(!db.prepare('SELECT 1 FROM purchases WHERE user_id=? AND lesson_id=?').get(user.id,lessonId))return json(res,403,{error:'اشترِ الحصة أولاً.'});
    if(!Number.isFinite(watched)||!Number.isFinite(duration)||watched<0||duration<1||watched>86400||duration>86400)return json(res,400,{error:'بيانات تقدم غير صالحة.'});
    db.prepare(`INSERT INTO lesson_progress(user_id,lesson_id,watched_seconds,duration_seconds) VALUES(?,?,?,?) ON CONFLICT(user_id,lesson_id) DO UPDATE SET watched_seconds=MAX(watched_seconds,excluded.watched_seconds),duration_seconds=MAX(duration_seconds,excluded.duration_seconds),updated_at=CURRENT_TIMESTAMP`).run(user.id,lessonId,watched,duration);
    return json(res,200,{ok:true});
  }
  if (route === '/api/buy' && req.method === 'POST') {
    if (!requireUser(user,res)) return;
    const lesson = db.prepare('SELECT id,price FROM lessons WHERE id=?').get(String(body.lessonId)); if (!lesson) return json(res,404,{error:'الحصة غير موجودة.'});
    if (db.prepare('SELECT 1 FROM purchases WHERE user_id=? AND lesson_id=?').get(user.id,lesson.id)) return json(res,200,{ok:true});
    if (user.balance < lesson.price) return json(res,400,{error:'رصيدك غير كافٍ. اشحن المحفظة أولاً.'});
    db.exec('BEGIN IMMEDIATE');
    try { db.prepare('UPDATE users SET balance=balance-? WHERE id=?').run(lesson.price,user.id); db.prepare('INSERT INTO purchases(user_id,lesson_id) VALUES(?,?)').run(user.id,lesson.id); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    return json(res,200,{ok:true,user:userView(db.prepare('SELECT id,username,email,name,phone,grade,role,balance,avatar FROM users WHERE id=?').get(user.id))});
  }
  if (route === '/api/redeem' && req.method === 'POST') {
    if (!requireUser(user,res)) return;
    const code=String(body.code||'').trim().toUpperCase(); db.exec('BEGIN IMMEDIATE');
    try { const row=db.prepare('SELECT amount FROM recharge_codes WHERE code=? AND used_by IS NULL').get(code); if(!row){db.exec('ROLLBACK');return json(res,400,{error:'الكود غير صالح أو سبق استخدامه.'});} db.prepare('UPDATE recharge_codes SET used_by=?,used_at=CURRENT_TIMESTAMP WHERE code=? AND used_by IS NULL').run(user.id,code); db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(row.amount,user.id); db.exec('COMMIT'); }
    catch(error){db.exec('ROLLBACK');throw error;}
    return json(res,200,{user:userView(db.prepare('SELECT id,username,email,name,phone,grade,role,balance,avatar FROM users WHERE id=?').get(user.id))});
  }
  if (route.startsWith('/api/admin/')) {
    if (!requireAdmin(user,res)) return;
    if (route === '/api/admin/overview' && req.method === 'GET') {
      return json(res,200,{codes:db.prepare('SELECT code,amount,used_at FROM recharge_codes ORDER BY created_at DESC').all(),students:db.prepare("SELECT u.id,u.username,u.name,u.phone,u.grade,u.balance,COALESCE(SUM(p.watched_seconds),0) AS watched_seconds FROM users u LEFT JOIN lesson_progress p ON p.user_id=u.id WHERE u.role='student' GROUP BY u.id ORDER BY u.created_at DESC").all(),progress:db.prepare("SELECT u.id AS student_id,u.name AS student_name,l.title AS lesson_title,p.watched_seconds,p.duration_seconds FROM lesson_progress p JOIN users u ON u.id=p.user_id JOIN lessons l ON l.id=p.lesson_id WHERE u.role='student' ORDER BY u.name,l.rowid").all(),lessons:db.prepare('SELECT id,title,video_url AS video FROM lessons').all()});
    }
    if (route === '/api/admin/codes' && req.method === 'POST') {
      const amount=Number(body.amount); if(!Number.isSafeInteger(amount)||amount<1||amount>1000000)return json(res,400,{error:'اكتب قيمة صحيحة للكود.'});
      let code; do {code=`HISHAM-${randomBytes(4).toString('hex').toUpperCase()}`} while(db.prepare('SELECT 1 FROM recharge_codes WHERE code=?').get(code));
      db.prepare('INSERT INTO recharge_codes(code,amount,created_by) VALUES(?,?,?)').run(code,amount,user.id); return json(res,201,{code,amount});
    }
    const codeDelete=route.match(/^\/api\/admin\/codes\/([^/]+)$/);
    if(codeDelete&&req.method==='DELETE'){db.prepare('DELETE FROM recharge_codes WHERE code=? AND used_by IS NULL').run(decodeURIComponent(codeDelete[1]));return json(res,200,{ok:true});}
    const studentDelete=route.match(/^\/api\/admin\/students\/(\d+)$/);
    if(studentDelete&&req.method==='DELETE'){db.prepare("DELETE FROM users WHERE id=? AND role='student'").run(Number(studentDelete[1]));return json(res,200,{ok:true});}
    const lessonUpdate=route.match(/^\/api\/admin\/lessons\/([^/]+)$/);
    if(lessonUpdate&&req.method==='PUT'){if(!validVideoLink(body.video))return json(res,400,{error:'أدخل رابط YouTube أو Vimeo صالحاً.'});db.prepare('UPDATE lessons SET video_url=? WHERE id=?').run(body.video,decodeURIComponent(lessonUpdate[1]));return json(res,200,{ok:true});}
    return json(res,404,{error:'المسار غير موجود.'});
  }
  return json(res,404,{error:'المسار غير موجود.'});
}
function verifyPassword(password, stored) {
  const [salt, expectedHex] = stored.split(':'); const expected=Buffer.from(expectedHex,'hex'); const actual=scryptSync(password,salt,64); return expected.length===actual.length&&timingSafeEqual(expected,actual);
}

const server = createServer(async (req,res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res,403,{error:'الطلب مرفوض.'});
    if (url.pathname.startsWith('/api/')) return await handleApi(req,res,url);
    const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    if (!publicFiles.has(requested)) return json(res,404,{error:'الملف غير موجود.'});
    const path = normalize(join(root,requested));
    if (!path.startsWith(root) || !existsSync(path)) return json(res,404,{error:'الملف غير موجود.'});
    res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
    createReadStream(path).pipe(res);
  } catch(error) { console.error(error); if(!res.headersSent)json(res,500,{error:error.message||'خطأ داخلي.'}); }
});
server.listen(port,'0.0.0.0',()=>console.log(`منصة مستر هشام المحمدي تعمل على المنفذ ${port}.`));
