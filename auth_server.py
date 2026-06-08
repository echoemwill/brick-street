"""
Brick Street — Auth Server
Serves the website AND handles login/register API.
Run: python3 auth_server.py
Then open: http://localhost:8080  (override with PORT env var)
"""

import os, sys, sqlite3, datetime, secrets, time, threading
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import jwt

# ── Load .env (so BS_SECRET / API keys don't have to be exported) ──
def _load_env():
    env_file = Path(__file__).parent / '.env'
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
_load_env()

# ── Config ─────────────────────────────────────────────────
DB_PATH  = os.path.join(os.path.dirname(__file__), 'data', 'users.db')
WEB_DIR  = os.path.join(os.path.dirname(__file__), 'website')
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
PORT     = int(os.environ.get('PORT', '8080'))
IS_PROD  = os.environ.get('BS_ENV', 'development').lower() == 'production'

# JWT signing secret. NEVER hardcode this — a leaked secret lets anyone
# forge a login token for any account. Must be set via env/.env in prod.
SECRET = os.environ.get('BS_SECRET')
if not SECRET:
    if IS_PROD:
        sys.exit('FATAL: BS_SECRET is not set. Refusing to start in production '
                 'with no signing secret. Add BS_SECRET=<random 32+ chars> to .env')
    SECRET = secrets.token_hex(32)
    print('⚠️  BS_SECRET not set — using a random dev secret. '
          'All sessions will be invalidated on restart.\n'
          '   Set BS_SECRET in .env to make sessions persistent.')

app = Flask(__name__, static_folder=WEB_DIR, static_url_path='')
# Lock CORS down in production; allow all only in dev for local testing.
CORS(app, origins='*' if not IS_PROD else os.environ.get('BS_ALLOWED_ORIGINS', '').split(','))

# ── Simple in-memory rate limiter (brute-force protection) ──
_rl_lock = threading.Lock()
_rl_hits = {}  # key -> list[timestamp]

def rate_limit(key: str, max_hits: int, window_s: int) -> bool:
    """Return True if the call is allowed, False if the limit is exceeded."""
    now = time.time()
    with _rl_lock:
        hits = [t for t in _rl_hits.get(key, []) if now - t < window_s]
        if len(hits) >= max_hits:
            _rl_hits[key] = hits
            return False
        hits.append(now)
        _rl_hits[key] = hits
        return True

def client_ip() -> str:
    fwd = request.headers.get('X-Forwarded-For', '')
    return fwd.split(',')[0].strip() if fwd else (request.remote_addr or 'unknown')

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
    conn.execute('''
        CREATE TABLE IF NOT EXISTS journal_entries (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            client_id  TEXT    NOT NULL,   -- uuid generated client-side (sync/dedup)
            type       TEXT    NOT NULL,   -- 'trade' | 'investment'
            data       TEXT    NOT NULL,   -- JSON blob of the entry fields
            created_at TEXT    DEFAULT (datetime('now')),
            updated_at TEXT    DEFAULT (datetime('now')),
            UNIQUE(user_id, client_id),
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
    if not rate_limit(f'register:{client_ip()}', max_hits=5, window_s=3600):
        return jsonify({'error': 'Too many sign-up attempts. Try again later.'}), 429
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
    if not rate_limit(f'login:{client_ip()}', max_hits=10, window_s=900):
        return jsonify({'error': 'Too many login attempts. Please wait and try again.'}), 429
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

# ── Journal (trading + investment) — account-synced storage ──
import json as _json

def _journal_rows(conn, user_id):
    rows = conn.execute(
        'SELECT client_id, type, data, created_at, updated_at '
        'FROM journal_entries WHERE user_id = ? ORDER BY updated_at DESC',
        (user_id,)
    ).fetchall()
    out = []
    for r in rows:
        try:
            data = _json.loads(r['data'])
        except (ValueError, TypeError):
            data = {}
        out.append({
            'client_id':  r['client_id'],
            'type':       r['type'],
            'data':       data,
            'created_at': r['created_at'],
            'updated_at': r['updated_at'],
        })
    return out

@app.route('/api/journal', methods=['GET'])
def get_journal():
    payload = require_auth()
    if not payload:
        return jsonify({'error': 'Unauthorized'}), 401
    conn = get_db()
    entries = _journal_rows(conn, payload['user_id'])
    conn.close()
    return jsonify({'entries': entries})

@app.route('/api/journal', methods=['POST'])
def upsert_journal():
    payload = require_auth()
    if not payload:
        return jsonify({'error': 'Unauthorized'}), 401
    body = request.get_json() or {}
    # Accept either a single entry or a list (for local→account migration).
    items = body.get('entries') if isinstance(body.get('entries'), list) else [body]

    conn = get_db()
    saved = 0
    for it in items:
        client_id = (it.get('client_id') or '').strip()
        etype     = (it.get('type') or '').strip()
        data      = it.get('data')
        if not client_id or etype not in ('trade', 'investment') or not isinstance(data, dict):
            continue
        conn.execute(
            '''INSERT INTO journal_entries (user_id, client_id, type, data)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(user_id, client_id) DO UPDATE SET
                 type = excluded.type,
                 data = excluded.data,
                 updated_at = datetime('now')''',
            (payload['user_id'], client_id, etype, _json.dumps(data))
        )
        saved += 1
    conn.commit()
    entries = _journal_rows(conn, payload['user_id'])
    conn.close()
    return jsonify({'ok': True, 'saved': saved, 'entries': entries})

@app.route('/api/journal/<client_id>', methods=['DELETE'])
def delete_journal(client_id):
    payload = require_auth()
    if not payload:
        return jsonify({'error': 'Unauthorized'}), 401
    conn = get_db()
    conn.execute('DELETE FROM journal_entries WHERE user_id = ? AND client_id = ?',
                 (payload['user_id'], client_id))
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'client_id': client_id})

# ── GDPR / privacy: data export + account deletion ──────────
@app.route('/api/auth/export', methods=['GET'])
def export_data():
    """Right of access/portability: return everything we hold on this user."""
    payload = require_auth()
    if not payload:
        return jsonify({'error': 'Unauthorized'}), 401
    conn = get_db()
    user = conn.execute('SELECT id, name, email, created_at FROM users WHERE id = ?',
                        (payload['user_id'],)).fetchone()
    rows = conn.execute('SELECT symbol, added_at FROM watchlist WHERE user_id = ?',
                        (payload['user_id'],)).fetchall()
    journal = _journal_rows(conn, payload['user_id'])
    conn.close()
    if not user:
        return jsonify({'error': 'Account not found'}), 404
    return jsonify({
        'account':   dict(user),
        'watchlist': [dict(r) for r in rows],
        'journal':   journal,
        'note': 'This is all personal data Brick Street stores about you. '
                'Card/billing data, if any, is held by our payment processor.'
    })

@app.route('/api/auth/account', methods=['DELETE'])
def delete_account():
    """Right to erasure: permanently delete the user and all their data."""
    payload = require_auth()
    if not payload:
        return jsonify({'error': 'Unauthorized'}), 401
    conn = get_db()
    conn.execute('DELETE FROM watchlist WHERE user_id = ?', (payload['user_id'],))
    conn.execute('DELETE FROM journal_entries WHERE user_id = ?', (payload['user_id'],))
    conn.execute('DELETE FROM users WHERE id = ?', (payload['user_id'],))
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'deleted': True})

# ── Quote endpoint (licensed — Finnhub, NOT Yahoo) ──────────
# Powers the per-stock detail panel. Premium fields (price history sparkline,
# exact analyst targets) populate only on a paid Finnhub plan; they degrade to
# empty/None on the free tier and the frontend handles that gracefully.
from data_sources import Finnhub, FinnhubError

_finnhub = None
def get_finnhub():
    global _finnhub
    if _finnhub is None:
        _finnhub = Finnhub()  # raises FinnhubError if key missing
    return _finnhub

@app.route('/api/quote/<symbol>', methods=['GET'])
def quote(symbol):
    symbol = symbol.strip().upper()[:10]
    try:
        fh = get_finnhub()
    except FinnhubError as e:
        return jsonify({'error': f'Data source not configured: {e}'}), 503
    try:
        q = fh.quote_raw(symbol)
        current = q.get('c') or None
        prev_close = q.get('pc') or None
        if not current:
            return jsonify({'error': f'Unknown symbol: {symbol}'}), 404

        rec_mean, num_analysts = fh.recommendation_mean(symbol)

        return jsonify({
            'symbol':              symbol,
            'company_name':        fh.company_name(symbol) or symbol,
            'current_price':       current,
            'prev_close':          prev_close,
            'closes':              fh.daily_closes(symbol),      # [] on free tier
            'analyst_targets':     fh.price_target(symbol),      # None on free tier
            'recommendation_mean': rec_mean,
            'num_analysts':        num_analysts,
        })
    except FinnhubError as e:
        return jsonify({'error': str(e)}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ── tiny in-memory news cache (15 min) so flipping through stocks
#    doesn't burn Finnhub calls or feel slow ──
_news_cache = {}            # symbol -> (timestamp, payload)
_news_lock  = threading.Lock()
NEWS_TTL    = 15 * 60

@app.route('/api/news/<symbol>', methods=['GET'])
def news(symbol):
    symbol = symbol.strip().upper()[:10]
    if not symbol:
        return jsonify({'error': 'Invalid symbol'}), 400

    now = time.time()
    with _news_lock:
        hit = _news_cache.get(symbol)
        if hit and now - hit[0] < NEWS_TTL:
            return jsonify(hit[1])

    try:
        fh = get_finnhub()
    except FinnhubError as e:
        return jsonify({'error': f'Data source not configured: {e}'}), 503
    try:
        payload = {'symbol': symbol, 'news': fh.company_news(symbol)}
        with _news_lock:
            _news_cache[symbol] = (now, payload)
        return jsonify(payload)
    except FinnhubError as e:
        return jsonify({'error': str(e)}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ── Compliance preflight (only enforced in production) ──────
def preflight_production_checks():
    """Refuse to go public with unfinished legal docs or a configured-but-unusable
    data source. Dev mode only warns. See LICENSING.md."""
    import re
    problems = []
    legal = Path(WEB_DIR) / 'legal.html'
    if legal.exists():
        # bracketed placeholders like [YOUR LEGAL NAME] must be filled before launch
        leftover = re.findall(r'\[[A-Z][^\]]{3,}\]', legal.read_text())
        if leftover:
            problems.append(f'legal.html still has {len(leftover)} unfilled placeholder(s) '
                            f'(e.g. {leftover[0]}). Fill them before going public.')
    else:
        problems.append('website/legal.html is missing (Terms/Privacy/Disclaimer).')
    if not os.environ.get('FINNHUB_API_KEY'):
        problems.append('FINNHUB_API_KEY is not set — no licensed data source configured.')

    if problems:
        msg = '\n   • '.join(problems)
        if IS_PROD:
            sys.exit('⛔ Refusing to start in production — compliance checks failed:\n   • '
                     + msg + '\n   (See LICENSING.md.)')
        print('⚠️  Compliance checks (warnings only in development):\n   • ' + msg + '\n')


# ── Run ─────────────────────────────────────────────────────
if __name__ == '__main__':
    init_db()
    preflight_production_checks()
    print('\n  Brick Street server running')
    print(f'  Open: http://localhost:{PORT}\n')
    app.run(host='0.0.0.0' if IS_PROD else '127.0.0.1', port=PORT, debug=not IS_PROD)
