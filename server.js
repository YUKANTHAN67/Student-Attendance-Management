const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcrypt');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serve frontend files

// Initialize SQLite database
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        
        // Create tables
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS students (
            id TEXT PRIMARY KEY,
            name TEXT,
            rollno TEXT UNIQUE,
            class TEXT,
            contact TEXT,
            faceDescriptor TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            studentId TEXT,
            status TEXT,
            time TEXT,
            UNIQUE(date, studentId)
        )`);

        // Insert default user if not exists
        db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
            if (!err && row.count === 0) {
                const saltRounds = 10;
                bcrypt.hash('admin123', saltRounds, function(err, hash) {
                    if (!err) {
                        db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", ['admin', hash, 'staff']);
                        console.log('Default user created: admin / admin123');
                    }
                });
            }
        });
    }
});

// API Routes

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ error: 'Invalid username or password' });

        bcrypt.compare(password, user.password, (err, result) => {
            if (result) {
                res.json({ success: true, user: { username: user.username, role: user.role } });
            } else {
                res.status(401).json({ error: 'Invalid username or password' });
            }
        });
    });
});

// Get all students
app.get('/api/students', (req, res) => {
    db.all("SELECT * FROM students", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Parse faceDescriptor string back to array
        const students = rows.map(r => ({
            ...r,
            faceDescriptor: r.faceDescriptor ? JSON.parse(r.faceDescriptor) : null
        }));
        res.json(students);
    });
});

// Add or update student
app.post('/api/students', (req, res) => {
    const { id, name, rollno, studentClass, contact, faceDescriptor } = req.body;
    const descStr = faceDescriptor ? JSON.stringify(faceDescriptor) : null;
    
    db.run(
        `INSERT INTO students (id, name, rollno, class, contact, faceDescriptor) 
         VALUES (?, ?, ?, ?, ?, ?) 
         ON CONFLICT(id) DO UPDATE SET 
         name=excluded.name, rollno=excluded.rollno, class=excluded.class, contact=excluded.contact`,
        [id, name, rollno, studentClass, contact, descStr],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// Update student face descriptor
app.put('/api/students/:id/face', (req, res) => {
    const { faceDescriptor } = req.body;
    const descStr = faceDescriptor ? JSON.stringify(faceDescriptor) : null;
    
    db.run("UPDATE students SET faceDescriptor = ? WHERE id = ?", [descStr, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Delete student
app.delete('/api/students/:id', (req, res) => {
    db.run("DELETE FROM students WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // delete their attendance too
        db.run("DELETE FROM attendance WHERE studentId = ?", [req.params.id], () => {
            res.json({ success: true });
        });
    });
});

// Get attendance for a date
app.get('/api/attendance/:date', (req, res) => {
    db.all("SELECT * FROM attendance WHERE date = ?", [req.params.date], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const attendanceMap = {};
        rows.forEach(r => {
            attendanceMap[r.studentId] = r.status;
        });
        res.json(attendanceMap);
    });
});

// Get all attendance
app.get('/api/attendance', (req, res) => {
    db.all("SELECT * FROM attendance", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const attendanceMap = {};
        rows.forEach(r => {
            if (!attendanceMap[r.date]) attendanceMap[r.date] = {};
            attendanceMap[r.date][r.studentId] = { status: r.status, time: r.time };
        });
        res.json(attendanceMap);
    });
});

// Mark attendance
app.post('/api/attendance', (req, res) => {
    const { date, studentId, status, time } = req.body;
    db.run(
        `INSERT INTO attendance (date, studentId, status, time) VALUES (?, ?, ?, ?)
         ON CONFLICT(date, studentId) DO UPDATE SET status=excluded.status, time=excluded.time`,
        [date, studentId, status, time],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// Send Alert SMS to Parents (Mock)
app.post('/api/notify', (req, res) => {
    const { studentId, studentName, message } = req.body;
    // In a real application, this would use Twilio or a similar SMS/Email service
    console.log(`\n===========================================`);
    console.log(`[ALERT DISPATCHED TO PARENTS]`);
    console.log(`Student: ${studentName} (ID: ${studentId})`);
    console.log(`Message: ${message}`);
    console.log(`===========================================\n`);
    res.json({ success: true, message: "Alert sent to parents successfully." });
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
