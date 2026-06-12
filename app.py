from flask import Flask, request, jsonify, render_template, redirect, url_for, session
import json
import os
from datetime import datetime
import uuid

app = Flask(__name__)
app.secret_key = 'inv_secret_key_2026_change_in_prod'

DATA_FILE  = os.path.join(os.path.dirname(__file__), 'data.json')
USERS_FILE = os.path.join(os.path.dirname(__file__), 'users.json')


def load_users() -> dict:
    if not os.path.exists(USERS_FILE):
        default = {
            "admin": {"password": "admin123", "role": "Admin",    "name": "Admin User"},
            "john":  {"password": "john123",  "role": "Manager",  "name": "John Doe"},
            "sara":  {"password": "sara123",  "role": "Operator", "name": "Sara Khan"}
        }
        with open(USERS_FILE, 'w') as f:
            json.dump(default, f, indent=2)
    with open(USERS_FILE) as f:
        return json.load(f)


def check_login(username: str, password: str):
    users = load_users()
    u = users.get(username.lower())
    if u and u['password'] == password:
        return u
    return None


def load_data() -> dict:
    if not os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'w') as f:
            json.dump({"items": []}, f)
    with open(DATA_FILE) as f:
        raw = json.load(f)
    index = {item['id']: item for item in raw.get('items', [])}
    return {"items": raw.get('items', []), "index": index}


def save_data(items: list) -> None:
    with open(DATA_FILE, 'w') as f:
        json.dump({"items": items}, f, indent=2)


def get_status(quantity: int) -> str:
    if quantity == 0: return "Out of Stock"
    if quantity < 5:  return "Low Stock"
    return "In Stock"


def validate_item(data: dict, require_id: bool = False):
    required = ['name', 'quantity', 'supplier', 'price']
    if require_id: required.append('id')
    for field in required:
        if field not in data or str(data[field]).strip() == '':
            return False, f"Missing or empty field: '{field}'"
    try:
        if int(data['quantity']) < 0: return False, "Quantity must be >= 0"
    except: return False, "Quantity must be a valid integer"
    try:
        if float(data['price']) < 0: return False, "Price must be >= 0"
    except: return False, "Price must be a valid number"
    return True, ""


def login_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user' not in session:
            if request.is_json or request.method in ('PUT','DELETE') or '/get_items' in request.path or '/stats' in request.path:
                return jsonify({"success": False, "message": "Unauthorized"}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated


@app.route('/login', methods=['GET', 'POST'])
def login():
    if 'user' in session:
        return redirect(url_for('index'))
    error = None
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '').strip()
        user = check_login(username, password)
        if user:
            session['user'] = {"username": username.lower(), "name": user['name'], "role": user['role']}
            return redirect(url_for('index'))
        error = "Invalid username or password."
    return render_template('login.html', error=error)


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


@app.route('/')
@login_required
def index():
    return render_template('index.html', user=session['user'])


@app.route('/get_items', methods=['GET'])
@login_required
def get_items():
    db = load_data()
    items = db['items']
    for item in items:
        item['status'] = get_status(item['quantity'])
    return jsonify({"success": True, "items": items, "count": len(items)})


@app.route('/add_item', methods=['POST'])
@login_required
def add_item():
    data = request.get_json()
    ok, msg = validate_item(data)
    if not ok: return jsonify({"success": False, "message": msg}), 400
    db = load_data()
    for item in db['items']:
        if item['name'].lower() == data['name'].strip().lower() and item['supplier'].lower() == data['supplier'].strip().lower():
            return jsonify({"success": False, "message": "Item with this name and supplier already exists."}), 409
    new_item = {
        "id": str(uuid.uuid4())[:8],
        "name": data['name'].strip(),
        "quantity": int(data['quantity']),
        "supplier": data['supplier'].strip(),
        "price": round(float(data['price']), 2),
        "last_updated": datetime.now().isoformat(timespec='seconds')
    }
    db['items'].append(new_item)
    save_data(db['items'])
    new_item['status'] = get_status(new_item['quantity'])
    return jsonify({"success": True, "message": "Item added.", "item": new_item}), 201


@app.route('/update_item', methods=['PUT'])
@login_required
def update_item():
    data = request.get_json()
    ok, msg = validate_item(data, require_id=True)
    if not ok: return jsonify({"success": False, "message": msg}), 400
    db = load_data()
    if data['id'] not in db['index']:
        return jsonify({"success": False, "message": "Item not found."}), 404
    target = db['index'][data['id']]
    target.update({"name": data['name'].strip(), "quantity": int(data['quantity']),
                   "supplier": data['supplier'].strip(), "price": round(float(data['price']), 2),
                   "last_updated": datetime.now().isoformat(timespec='seconds')})
    save_data(db['items'])
    target['status'] = get_status(target['quantity'])
    return jsonify({"success": True, "message": "Item updated.", "item": target})


@app.route('/delete_item/<item_id>', methods=['DELETE'])
@login_required
def delete_item(item_id):
    db = load_data()
    if item_id not in db['index']:
        return jsonify({"success": False, "message": "Item not found."}), 404
    db['items'] = [i for i in db['items'] if i['id'] != item_id]
    save_data(db['items'])
    return jsonify({"success": True, "message": "Item deleted."})


@app.route('/stats', methods=['GET'])
@login_required
def stats():
    db = load_data()
    items = db['items']
    return jsonify({
        "success": True,
        "total_items": len(items),
        "low_stock": sum(1 for i in items if 0 < i['quantity'] < 5),
        "out_of_stock": sum(1 for i in items if i['quantity'] == 0),
        "total_value": round(sum(i['price'] * i['quantity'] for i in items), 2),
        "unique_suppliers": len(set(i['supplier'] for i in items))
    })


if __name__ == '__main__':
    app.run(debug=True, port=5000)
