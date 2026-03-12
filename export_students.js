const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Verify the DB file name is correct
const db = new sqlite3.Database('./database.sqlite');
const stream = fs.createWriteStream('friend_30_students.csv');

// Write the Header
stream.write('name,rollno,class,contact,faceDescriptor\n');

db.all("SELECT * FROM students", [], (err, rows) => {
    if (err) {
        console.error("Database Error:", err.message);
        return;
    }

    rows.forEach(row => {
        // FIXED LINE: Using backticks (`) and wrapping everything in one string
        stream.write("${row.name}", "${row.rollno}", "${row.class}", "${row.contact}", "${row.faceDescriptor}"\n);
    });

    console.log("------------------------------------------");
    console.log(✅ SUCCESS: ${ rows.length } students exported!);
    console.log("File saved as: friend_30_students.csv");
    console.log("------------------------------------------");
    db.close();
});