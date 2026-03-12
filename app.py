from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import sqlite3
import bcrypt
import json
import os

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

DB_PATH = './database.sqlite'

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    c = conn.cursor()
    
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS students (
            id TEXT PRIMARY KEY,
            name TEXT,
            rollno TEXT UNIQUE,
            class TEXT,
            contact TEXT,
            faceDescriptor TEXT
        )
    ''')
    try:
        c.execute("ALTER TABLE students ADD COLUMN year TEXT")
    except sqlite3.OperationalError:
        pass

    c.execute('''
        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            studentId TEXT,
            status TEXT,
            time TEXT,
            UNIQUE(date, studentId)
        )
    ''')

    c.execute("SELECT COUNT(*) as count FROM users")
    row = c.fetchone()
    if row['count'] == 0:
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(b'admin123', salt).decode('utf-8')
        c.execute("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", 
                  ('admin', hashed, 'staff'))
        print('Default user created: admin / admin123')
    
    conn.commit()
    conn.close()

init_db()

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    if os.path.exists(path):
        return send_from_directory('.', path)
    return "Not Found", 404

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    conn = get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    
    if user and bcrypt.checkpw(password.encode('utf-8'), user['password'].encode('utf-8')):
        return jsonify({"success": True, "user": {"username": user['username'], "role": user['role']}})
    else:
        return jsonify({"error": "Invalid username or password"}), 401

@app.route('/api/students', methods=['GET'])
def get_students():
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM students").fetchall()
    conn.close()
    
    students = []
    for r in rows:
        student = dict(r)
        student['faceDescriptor'] = json.loads(student['faceDescriptor']) if student['faceDescriptor'] else None
        students.append(student)
        
    return jsonify(students)

@app.route('/api/students', methods=['POST'])
def add_update_student():
    data = request.get_json()
    sid = data.get('id')
    name = data.get('name')
    rollno = data.get('rollno')
    studentClass = data.get('class')
    contact = data.get('contact')
    year = data.get('year')
    faceDescriptor = data.get('faceDescriptor')
    
    descStr = json.dumps(faceDescriptor) if faceDescriptor else None
    
    conn = get_db_connection()
    try:
        conn.execute('''
            INSERT INTO students (id, name, rollno, class, contact, faceDescriptor, year) 
            VALUES (?, ?, ?, ?, ?, ?, ?) 
            ON CONFLICT(id) DO UPDATE SET 
            name=excluded.name, rollno=excluded.rollno, class=excluded.class, contact=excluded.contact, year=excluded.year
        ''', (sid, name, rollno, studentClass, contact, descStr, year))
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/students/<id>/face', methods=['PUT'])
def update_face(id):
    data = request.get_json()
    faceDescriptor = data.get('faceDescriptor')
    descStr = json.dumps(faceDescriptor) if faceDescriptor else None
    
    conn = get_db_connection()
    try:
        conn.execute("UPDATE students SET faceDescriptor = ? WHERE id = ?", (descStr, id))
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/students/<id>', methods=['DELETE'])
def delete_student(id):
    conn = get_db_connection()
    try:
        conn.execute("DELETE FROM students WHERE id = ?", (id,))
        conn.execute("DELETE FROM attendance WHERE studentId = ?", (id,))
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/attendance/<date>', methods=['GET'])
def get_attendance_date(date):
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM attendance WHERE date = ?", (date,)).fetchall()
    conn.close()
    
    attendanceMap = {}
    for r in rows:
        attendanceMap[r['studentId']] = r['status']
    
    return jsonify(attendanceMap)

@app.route('/api/attendance', methods=['GET'])
def get_all_attendance():
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM attendance").fetchall()
    conn.close()
    
    attendanceMap = {}
    for r in rows:
        date = r['date']
        if date not in attendanceMap:
            attendanceMap[date] = {}
        attendanceMap[date][r['studentId']] = {"status": r['status'], "time": r['time']}
        
    return jsonify(attendanceMap)

@app.route('/api/attendance', methods=['POST'])
def mark_attendance():
    data = request.get_json()
    date = data.get('date')
    studentId = data.get('studentId')
    status = data.get('status')
    time = data.get('time')
    
    conn = get_db_connection()
    try:
        conn.execute('''
            INSERT INTO attendance (date, studentId, status, time) VALUES (?, ?, ?, ?)
            ON CONFLICT(date, studentId) DO UPDATE SET status=excluded.status, time=excluded.time
        ''', (date, studentId, status, time))
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/notify', methods=['POST'])
def notify():
    data = request.get_json()
    studentId = data.get('studentId')
    studentName = data.get('studentName')
    message = data.get('message')
    
    print("\n===========================================")
    print("[ALERT DISPATCHED TO PARENTS]")
    print(f"Student: {studentName} (ID: {studentId})")
    print(f"Message: {message}")
    print("===========================================\n")
    
    return jsonify({"success": True, "message": "Alert sent to parents successfully."})

if __name__ == '__main__':
    app.run(port=3000, debug=True)
