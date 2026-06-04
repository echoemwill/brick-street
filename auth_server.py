"""
Brick Street — Auth Server
Serves the website AND handles login/register API.
Run: python3 auth_server.py
Then open: http://localhost:5000
"""

import os, sqlite3, datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import jwt

# ── Config ─────────────────────────────────────────────────
SECRET   = os.environ.get('BS_SECRET', 'brick-street-secret-2024-xK9p')
DB_PATH  = os.path.join(os.path.dirname(__file__), 'data', 'users.db')
WEB_DIR  = os.path.join(os.path.dirname(__file__), 'website')
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')

app = Flask(__name__, static_folder=WEB_DIR, static_url_path='')
CORS(app)

# ── Database ────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT    NOT NULL,
            email        TEXT    UNIQUE NOT NULL,
            password_hash TEXT   NOT NULL,
            created_at   TEXT    DEFAULT (datetime('now'))
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS watchlist (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            symbol     TEXT    NOT NULL,
            added_at   TEXT    DEFAULT (datetime('now')),
            UNIQUE(user_id, symbol),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')
    conn.commit()
    conn.close()
    print(f'  Database ready: {DB_PATH}')

# ── Token helpers ───────────────────────────────────────────
def make_token(user):
    payload = {
        'user_id': user['id'],
        'name':    user['name'],
        'email':   user['email'],
        'exp':     datetime.datetime.utcnow() + datetime.timedelta(days=30)
    }
    return jwt.encode(payload, SECRET, algorithm='HS256')

def decode_token(token):
    return jwt.decode(token, SECRET, algorithms=['HS256'])

def require_auth():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return None
    try:
        return decode_token(auth[7:])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None

# ── Static file routes ──────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory(WEB_DIR, 'index.html')

@app.route('/data/<path:filename>')
def data_files(filename):
    return send_from_directory(DATA_DIR, filename)

# ── Auth API ────────────────────────────────────────────────
@app.route('/api/auth/register', methods=['POST'])
def register():
    d        = request.get_json() or {}
    name     = (d.get('name') or '').strip()
    email    = (d.get('email') or '').strip().lower()
    password = (d.get('password') or '')

    if not name or not email or not password:
        return jsonify({'error': 'All fields are required'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    if '@' not in email:
        return jsonify({'error': 'Please enter a valid email'}), 400

    conn = get_db()
    try:
        conn.execute(
            'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
            (name, email, generate_password_hash(password, method='pbkdf2:sha256'))
        )
        conn.commit()
        user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        return jsonify({'token': make_token(user), 'user': {
            'id': user['id'], 'name': user['name'], 'email': user['email']
        }})
    except sqlite3.IntegrityError:
        return jsonify({'error': 'This email is already registered'}), 409
    finally:
        conn.close()

@app.route('/api/auth/login', methods=['POST'])
def login():
    d        = request.get_json() or {}
    email    = (d.get('email') or '').strip().lower()
    password = (d.get('password') or '')

    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    conn.close()

    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'Incorrect email or password'}), 401

    return jsonify({'token': make_token(user), 'user': {
        'id': user['id'], 'name': user['name'], 'email': user['email']
    }})

@app.route('/api/auth/me', methods=['GET'])
def me():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({'error': 'No token provided'}), 401
    try:
        p = decode_token(auth[7:])
        return jsonify({'user': {'id': p['user_id'], 'name': p['name'], 'email': p['email']}})
    except jwt.ExpiredSignatureError:
        return jsonify({'error': 'Session expired, please log in again'}), 401
    except jwt.InvalidTokenError:
        return jsonify({'error': 'Invalid token'}), 401

# ── Watchlist API ───────────────────────────────────────────
@app.route('/api/watchlist', methods=['GET'])
def get_watchlist():
    payload = require_auth()
    if not payload:
        return jsonify({'error': 'Unauthorized'}), 401
    conn = get_db()
    rows = conn.execute(
        'SELECT symbol, added_at FROM watchlist WHERE user_id = ? ORDER BY added_at DESC',
        (payload['user_id'],)
    ).fetchall()
    conn.close()
    return jsonify({'symbols': [dict(r) for r in rows]})

@app.route('/api/watchlist', methods=['POST'])
def add_to_watchlist():
    payload = require_auth()
    if not payload:
        return jsonify({'error': 'Unauthorized'}), 401
    symbol = ((request.get_json() or {}).get('symbol') or '').strip().upper()
    if not symbol:
        return jsonify({'error': 'Symbol required'}), 400
    conn = get_db()
    try:
        conn.execute('INSERT INTO watchlist (user_id, symbol) VALUES (?, ?)', (payload['user_id'], symbol))
        conn.commit()
    except sqlite3.IntegrityError:
        pass  # already in watchlist
    finally:
        conn.close()
    return jsonify({'ok': True, 'symbol': symbol})

@app.route('/api/watchlist/<symbol>', methods=['DELETE'])
def remove_from_watchlist(symbol):
    payload = require_auth()
    if not payload:
        return jsonify({'error': 'Unauthorized'}), 401
    symbol = symbol.strip().upper()
    conn = get_db()
    conn.execute('DELETE FROM watchlist WHERE user_id = ? AND symbol = ?', (payload['user_id'], symbol))
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'symbol': symbol})

# ── Run ─────────────────────────────────────────────────────
if __name__ == '__main__':
    init_db()
    print('\n  Brick Street server running')
    print('  Open: http://localhost:5000\n')
    app.run(port=8080, debug=False)
