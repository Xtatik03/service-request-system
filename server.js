/**
 * Public Service Request System - Express + SQLite REST API.
 * Serves the static frontend from /public.
 */
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const STATUSES = ['Pending', 'In Progress', 'Resolved'];
const CATEGORIES = ['Streetlight', 'Water Issue', 'Garbage Collection', 'Road Damage', 'Drainage', 'Other'];

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Database ----------
const db = new Database(path.join(DATA_DIR, 'app.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'citizen');
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL, location TEXT NOT NULL, description TEXT NOT NULL,
  image TEXT, status TEXT NOT NULL DEFAULT 'Pending', admin_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

// Seed a default admin (override via env vars in production).
const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
if (!db.prepare('SELECT 1 FROM users WHERE email = ?').get(adminEmail)) {
  db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)')
    .run('Administrator', adminEmail, bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10), 'admin');
}

// ---------- Middleware ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, /^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype)),
});

const sign = (u) => jwt.sign({ id: u.id, role: u.role, name: u.name }, SECRET, { expiresIn: '7d' });

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: 'Please log in.' }); }
}
const adminOnly = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' });

// ---------- Auth routes ----------
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(email || '') || (password || '').length < 6)
    return res.status(400).json({ error: 'Valid name, email and a password of 6+ characters are required.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.toLowerCase()))
    return res.status(409).json({ error: 'Email already registered.' });
  const info = db.prepare('INSERT INTO users (name,email,password) VALUES (?,?,?)')
    .run(name.trim(), email.toLowerCase(), bcrypt.hashSync(password, 10));
  const user = { id: info.lastInsertRowid, role: 'citizen', name: name.trim() };
  res.status(201).json({ token: sign(user), user });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(password || '', u.password))
    return res.status(401).json({ error: 'Invalid email or password.' });
  res.json({ token: sign(u), user: { id: u.id, name: u.name, role: u.role } });
});

// ---------- Request routes ----------
app.get('/api/meta', (_, res) => res.json({ statuses: STATUSES, categories: CATEGORIES }));

app.post('/api/requests', auth, upload.single('image'), (req, res) => {
  const { category, location, description } = req.body;
  if (!CATEGORIES.includes(category) || !location?.trim() || !description?.trim())
    return res.status(400).json({ error: 'Category, location and description are required.' });
  const info = db.prepare('INSERT INTO requests (user_id,category,location,description,image) VALUES (?,?,?,?,?)')
    .run(req.user.id, category, location.trim(), description.trim(), req.file ? '/uploads/' + req.file.filename : null);
  res.status(201).json({ id: info.lastInsertRowid });
});

// Citizens see their own requests; admins see all (with optional filters).
app.get('/api/requests', auth, (req, res) => {
  const { status, category, q } = req.query;
  const where = [], args = [];
  if (req.user.role !== 'admin') { where.push('r.user_id = ?'); args.push(req.user.id); }
  if (STATUSES.includes(status)) { where.push('r.status = ?'); args.push(status); }
  if (CATEGORIES.includes(category)) { where.push('r.category = ?'); args.push(category); }
  if (q) { where.push('(r.location LIKE ? OR r.description LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const sql = `SELECT r.*, u.name AS citizen FROM requests r JOIN users u ON u.id = r.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.id DESC`;
  res.json(db.prepare(sql).all(...args));
});

app.patch('/api/requests/:id', auth, adminOnly, (req, res) => {
  const { status, admin_note } = req.body || {};
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const info = db.prepare('UPDATE requests SET status=?, admin_note=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(status, (admin_note || '').trim() || null, req.params.id);
  info.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Request not found.' });
});

// ---------- Analytics ----------
app.get('/api/stats', auth, adminOnly, (_, res) => {
  const by = (col) => db.prepare(`SELECT ${col} AS label, COUNT(*) AS n FROM requests GROUP BY ${col}`).all();
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  by('status').forEach((r) => (byStatus[r.label] = r.n));
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  res.json({ total, open: byStatus.Pending + byStatus['In Progress'], resolved: byStatus.Resolved, byStatus, byCategory: by('category') });
});

app.use((err, _req, res, _next) => res.status(400).json({ error: err.message || 'Something went wrong.' }));
app.listen(PORT, () => console.log(`Service Request System running on port ${PORT}`));
