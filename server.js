/*
 * Meridian Expenses — staff expense portal (Express edition).
 *
 * *** INTENTIONALLY VULNERABLE. TEACHING ARTEFACT. ***
 * Issued for CCT PGDip Cybersecurity, Secure Programming and Scripting, CA1.
 * Do not deploy. Do not expose beyond localhost. Contains no real data.
 *
 * There are more than six distinct, independently exploitable defects across
 * this file and its views. They are not marked.
 */
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET must be set in the .env file.');

const app = express();
const db = new Database(path.join(__dirname, 'expenses.db'));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

function currentUser(req) {
  const t = req.cookies.token;
  if (!t) return null;
  try {
    return jwt.verify(t, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (e) {
    return null;
  }
}

app.get('/', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.redirect('/login');
  const rows = db.prepare('SELECT * FROM claims WHERE user_id = ? ORDER BY id DESC').all(u.uid);
  res.render('index', { claims: rows, user: u });
});

app.get('/login', (req, res) => res.render('login', { error: req.query.e || null }));

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  const row = db.prepare(
    'SELECT id, name, role, password FROM users WHERE username = ?'
  ).get(username);

  if (!row || !bcrypt.compareSync(password || '', row.password)) {
    return res.redirect('/login?e=' + encodeURIComponent('Invalid credentials.'));
  }
  const token = jwt.sign({ uid: row.id, name: row.name, role: row.role }, JWT_SECRET, { expiresIn: '1h' });
  res.cookie('token', token,{ httpOnly: true, sameSite: 'strict' });
  res.redirect('/');
});

app.get('/logout', (req, res) => { res.clearCookie('token'); res.redirect('/login'); });

app.get('/claim/:id', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.redirect('/login');
  const row = db.prepare('SELECT * FROM claims WHERE id = ? AND user_id = ?')
                .get(req.params.id, u.uid);
  if (!row) return res.status(404).send('Not found'); 
  res.render('claim', { c: row });
});

app.post('/claim/new', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.redirect('/login');
  db.prepare(`INSERT INTO claims (user_id, merchant, amount, note, status)
              VALUES (?,?,?,?,'pending')`)
    .run(u && u.uid, req.body.merchant, req.body.amount, req.body.note);
  res.redirect('/');
});

app.get('/receipt', (req, res) => {
  const filename = req.query.f;
  if (typeof filename !== 'string' || !/^claim-[0-9]+\.txt$/.test(filename)) {
    return res.status(400).send('Invalid receipt filename.');
  }
  res.sendFile(filename, { root: path.join(__dirname, 'receipts') });
});

app.get('/export', (req, res) => {
  const month = req.query.month === undefined ? '2026-09' : req.query.month;
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).send('Month must be in YYYY-MM format.');
  }

  const rows = db.prepare('SELECT * FROM claims').raw().all();
  const csv = rows.map((row) => row.map((value) => {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\r\n');

  res.attachment(`expenses-${month}.csv`);
  res.send(csv ? `${csv}\r\n` : '');
});

app.post('/profile', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.redirect('/login');

  const fields = Object.keys(req.body);
  if (fields.length !== 1 || fields[0] !== 'name' ||
      typeof req.body.name !== 'string' || !req.body.name.trim()) {
    return res.status(400).send('Enter a valid name.');
  }

  db.prepare('UPDATE users SET name = ? WHERE id = ?')
    .run(req.body.name, u.uid);
  res.redirect('/');
});

app.get('/admin/users', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.redirect('/login');
  if (u.role !== 'admin') return res.status(403).send('Forbidden');
  const rows = db.prepare('SELECT id, username, name, role FROM users').all();
  res.render('admin', { users: rows });
});

app.listen(3000, '127.0.0.1', () =>
  console.log('Meridian Expenses (vulnerable) on http://127.0.0.1:3000'));
