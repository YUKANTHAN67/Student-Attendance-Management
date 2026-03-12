/**
 * Attendify Application Logic
 */

// App State
let appData = {
    students: [],
    attendance: {} // Format: { "YYYY-MM-DD": { "studentId": "present|absent|late" } }
};

let currentTab = 'dashboard';
let sortConfig = { key: null, asc: true };
let charts = { today: null, trend: null };

// Face Recognition State
let faceModelsLoaded = false;
let faceRecStream = null;
let regFaceStream = null;
let faceInterval = null;
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.3/model/';

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return; // Stop init if not authenticated

    loadData();
    initTheme();
    initNavigation();
    initTime();
    
    // Set default date to today for attendance
    document.getElementById('attendanceDate').valueAsDate = new Date();
    document.getElementById('reportStartDate').valueAsDate = new Date(new Date().setDate(new Date().getDate() - 7));
    document.getElementById('reportEndDate').valueAsDate = new Date();

    // Event Listeners
    setupEventListeners();
    
    
    // Render initial view
    updateView('dashboard');
    
    // Load face-api models asynchronously
    loadFaceModels();
});

// --- Node.js Backend URL ---
const API_URL = 'http://localhost:3000/api';

// --- Data Management ---
async function loadData() {
    try {
        const [studentsRes, attendanceRes] = await Promise.all([
            fetch(`${API_URL}/students`),
            fetch(`${API_URL}/attendance`)
        ]);
        
        if (studentsRes.ok) {
            appData.students = await studentsRes.json();
        }
        
        if (attendanceRes.ok) {
            appData.attendance = await attendanceRes.json();
        }
        
        updateDashboard();
        if (currentTab === 'students') renderStudents();
        if (currentTab === 'attendance') renderAttendance();
        
    } catch (e) {
        console.error("Failed to fetch data from server", e);
        showToast("Could not load data from database", "error");
    }
}

// saveData is mostly not needed anymore if we sync everything directly with DB
// We keep it empty for compatibility with local UI updates
function saveData() {
    // Left empty since we save to database in each specific function
    // But we still trigger UI updates where it used to be called
    updateDashboard();
}

// --- Authentication ---
function checkAuth() {
    const token = sessionStorage.getItem('auth_token');
    if (!token) {
        window.location.href = 'login.html';
        return false;
    }
    
    // Set UI 
    const role = sessionStorage.getItem('user_role') || 'staff';
    const name = sessionStorage.getItem('user_name') || 'User';
    
    document.getElementById('userNameDisplay').textContent = name;
    document.getElementById('userRoleDisplay').textContent = role;
    
    // Optional: Hide settings for staff
    if (role === 'staff') {
        const settingsTab = document.querySelector('[data-tab="settings"]');
        if (settingsTab) settingsTab.style.display = 'none';
    }
    return true;
}

function logout() {
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('user_role');
    sessionStorage.removeItem('user_name');
    window.location.href = 'login.html';
}

// --- Theme ---
function initTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const toggleIcon = themeToggle.querySelector('i');
    const toggleText = themeToggle.querySelector('span');

    const isDark = localStorage.getItem('theme') === 'dark' || 
                  (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    
    if (isDark) {
        document.documentElement.classList.add('dark');
        toggleIcon.className = 'fa-solid fa-sun text-yellow-500';
        toggleText.textContent = 'Light Mode';
    } else {
        document.documentElement.classList.remove('dark');
        toggleIcon.className = 'fa-solid fa-moon text-gray-700';
        toggleText.textContent = 'Dark Mode';
    }

    themeToggle.addEventListener('click', () => {
        document.documentElement.classList.toggle('dark');
        if (document.documentElement.classList.contains('dark')) {
            localStorage.setItem('theme', 'dark');
            toggleIcon.className = 'fa-solid fa-sun text-yellow-500';
            toggleText.textContent = 'Light Mode';
        } else {
            localStorage.setItem('theme', 'light');
            toggleIcon.className = 'fa-solid fa-moon text-gray-700';
            toggleText.textContent = 'Dark Mode';
        }
        // Redraw charts for theme change
        if (currentTab === 'dashboard') updateDashboard();
    });
}

// --- Navigation & Routing ---
function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const tabId = btn.getAttribute('data-tab');
            switchTab(tabId);
        });
    });
}

function switchTab(tabId) {
    currentTab = tabId;
    
    // Update active state in nav
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if(btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
            btn.classList.remove('text-gray-500');
        } else {
            btn.classList.remove('active');
            btn.classList.add('text-gray-500');
        }
    });

    // Update Views
    document.querySelectorAll('.view-section').forEach(view => {
        view.classList.remove('active');
    });
    document.getElementById(`view-${tabId}`).classList.add('active');

    // Update Title
    const titles = {
        'dashboard': 'Dashboard Overview',
        'students': 'Student Management',
        'attendance': 'Mark Attendance',
        'reports': 'Analytics & Reports',
        'settings': 'Data Settings'
    };
    document.getElementById('pageTitle').textContent = titles[tabId];

    updateView(tabId);
}

function updateView(tabId) {
    if (tabId === 'dashboard') updateDashboard();
    else if (tabId === 'students') renderStudents();
    else if (tabId === 'attendance') renderAttendance();
    else if (tabId === 'reports') initReportsTab();
    else if (tabId === 'facerec') {
        // Stop background scanners if switching away, though handled generally below
    }

    // Stop streams if leaving their specific tabs
    if (tabId !== 'facerec' && faceRecStream) stopFaceScanner();
    if (tabId !== 'students' && regFaceStream) closeFaceRegisterModal();
}

// --- Time & Utilities ---
function initTime() {
    const displayDate = document.querySelector('#displayDate span');
    const displayTime = document.querySelector('#displayTime span');
    
    const updateTime = () => {
        const now = new Date();
        
        // Date format: e.g. "Monday, October 16, 2023"
        if (displayDate) {
            displayDate.textContent = now.toLocaleDateString('en-US', { 
                weekday: 'long', 
                month: 'long', 
                day: 'numeric',
                year: 'numeric'
            });
        }
        
        // Time format: e.g. "08:45:30 AM"
        if (displayTime) {
            displayTime.textContent = now.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit'
            });
        }
    };
    
    updateTime();
    setInterval(updateTime, 1000); // Ticks every 1 second
}

function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toastIcon');
    const msgEl = document.getElementById('toastMsg');
    
    // Reset classes
    toast.className = 'fixed bottom-6 right-6 transform translate-y-20 opacity-0 transition-all duration-300 z-50 flex items-center gap-3 px-6 py-4 rounded-xl shadow-lg font-medium';
    icon.className = 'fa-solid';

    if (type === 'success') {
        toast.classList.add('toast-success');
        icon.classList.add('fa-check-circle');
    } else if (type === 'error') {
        toast.classList.add('toast-error');
        icon.classList.add('fa-circle-exclamation');
    } else if (type === 'warning') {
        toast.classList.add('toast-warning');
        icon.classList.add('fa-triangle-exclamation');
    }

    msgEl.textContent = msg;
    
    // Show
    setTimeout(() => {
        toast.classList.remove('translate-y-20', 'opacity-0');
        toast.classList.add('toast-visible');
    }, 10);

    // Hide
    setTimeout(() => {
        toast.classList.add('translate-y-20', 'opacity-0');
        toast.classList.remove('toast-visible');
    }, 3000);
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if(modalId === 'studentModal' && typeof regFaceStream !== 'undefined' && regFaceStream) {
        regFaceStream.getTracks().forEach(track => track.stop());
        regFaceStream = null;
    }
    modal.classList.add('opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('modal-open');
        modal.classList.remove('opacity-0'); // reset for next open
        if(modalId === 'studentModal') document.getElementById('studentForm').reset();
    }, 300);
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if(modalId === 'studentModal') {
        document.getElementById('studentForm').reset();
        document.getElementById('studentId').value = '';
        document.getElementById('studentModalTitle').textContent = 'Add New Student';
        document.getElementById('studentYear').value = '';
        
        // Reset Face logic
        document.getElementById('studentFaceDescriptor').value = '';
        const statusText = document.getElementById('faceStatusText');
        statusText.textContent = 'No face registered yet.';
        statusText.className = 'text-xs text-red-500 mb-2 font-semibold';
        
        document.getElementById('captureFaceBtn').classList.add('hidden');
        document.getElementById('captureFaceBtn').disabled = true;
        document.getElementById('startRegCameraBtn').classList.remove('hidden');
        document.getElementById('startRegCameraBtn').disabled = false;
        document.getElementById('regFaceVideo').classList.add('hidden');
        document.getElementById('regFacePlaceholder').classList.remove('hidden');
        document.getElementById('regFaceLoading').classList.add('hidden');
        if (typeof regFaceStream !== 'undefined' && regFaceStream) {
            regFaceStream.getTracks().forEach(track => track.stop());
            regFaceStream = null;
        }
    }
    
    // Add opacity-0 first if it was removed in a previous state
    modal.classList.add('opacity-0');
    modal.classList.remove('hidden');
    
    // Small delay for the browser to register the display block before transitioning opacity
    requestAnimationFrame(() => {
        setTimeout(() => {
            modal.classList.add('modal-open');
            modal.classList.remove('opacity-0');
        }, 10);
    });
}

// --- Event Listeners Setup ---
function setupEventListeners() {
    // Student Form Submit
    document.getElementById('studentForm').addEventListener('submit', (e) => {
        e.preventDefault();
        saveStudent();
    });

    // Student Search
    document.getElementById('studentSearch').addEventListener('input', () => {
        renderStudents();
    });

    // Attendance Date Change
    document.getElementById('attendanceDate').addEventListener('change', () => {
        renderAttendance();
    });
    
    // Attendance Class Filter Change
    document.getElementById('attendanceClassFilter').addEventListener('change', () => {
        renderAttendance();
    });

    // Mark All Present
    document.getElementById('markAllPresentBtn').addEventListener('click', markAllPresent);

    // Report Generate & Print
    document.getElementById('generateReportBtn').addEventListener('click', generateReport);
    document.getElementById('printReportBtn').addEventListener('click', () => window.print());

    // Report Type Change
    document.getElementById('reportType').addEventListener('change', (e) => {
        const studentSelect = document.getElementById('reportStudentSelect');
        if (e.target.value === 'student') {
            studentSelect.classList.remove('hidden');
            populateReportStudentSelect();
        } else {
            studentSelect.classList.add('hidden');
        }
    });
    
    // Face Rec Events
    document.getElementById('startFaceRecBtn').addEventListener('click', startFaceScanner);
    document.getElementById('stopFaceRecBtn').addEventListener('click', stopFaceScanner);

    // Allow closing modal by clicking backdrop
    window.addEventListener('click', (e) => {
        const modals = ['studentModal', 'confirmClearModal'];
        modals.forEach(id => {
            const modal = document.getElementById(id);
            if(e.target === modal) {
                closeModal(id);
            }
        });
    });
}

// --- Student Management ---
async function saveStudent() {
    const idField = document.getElementById('studentId').value;
    const name = document.getElementById('studentName').value.trim();
    const rollno = document.getElementById('studentRoll').value.trim();
    const studentClass = document.getElementById('studentClass').value.trim();
    const contact = document.getElementById('studentContact').value.trim();
    const year = document.getElementById('studentYear').value;

    const faceDescStr = document.getElementById('studentFaceDescriptor').value;
    const faceDescriptor = faceDescStr ? JSON.parse(faceDescStr) : null;

    let id = idField || ('stu_' + Date.now().toString(36) + Math.random().toString(36).substr(2));

    try {
        const res = await fetch(`${API_URL}/students`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name, rollno, studentClass, contact, year, faceDescriptor })
        });
        
        if (!res.ok) throw new Error("Roll number might already exist");
        
        const isNew = !idField;
        
        showToast(isNew ? 'Student added successfully' : 'Student updated successfully');
        
        await loadData(); // Reload from DB
        closeModal('studentModal');
        renderStudents();
    } catch(err) {
        showToast(err.message, 'error');
    }
}

function editStudent(id) {
    const student = appData.students.find(s => s.id === id);
    if(!student) return;

    document.getElementById('studentId').value = student.id;
    document.getElementById('studentName').value = student.name;
    document.getElementById('studentRoll').value = student.rollno;
    document.getElementById('studentClass').value = student.class;
    document.getElementById('studentContact').value = student.contact || '';
    document.getElementById('studentYear').value = student.year || '';
    
    if (student.faceDescriptor && student.faceDescriptor.length > 0) {
        document.getElementById('studentFaceDescriptor').value = JSON.stringify(student.faceDescriptor);
        const statusText = document.getElementById('faceStatusText');
        statusText.textContent = 'Face is already registered. You can scan again to overwrite.';
        statusText.className = 'text-xs text-green-500 mb-2 font-semibold';
    }
    
    document.getElementById('studentModalTitle').textContent = 'Edit Student';
    
    const modal = document.getElementById('studentModal');
    modal.classList.add('opacity-0');
    modal.classList.remove('hidden');
    
    requestAnimationFrame(() => {
        setTimeout(() => {
            modal.classList.add('modal-open');
            modal.classList.remove('opacity-0');
        }, 10);
    });
}

function viewStudentProfile(studentId) {
    switchTab('reports');
    document.getElementById('reportType').value = 'student';
    document.getElementById('reportStudentSelect').classList.remove('hidden');
    
    // Ensure the student select is populated
    populateReportStudentSelect();
    document.getElementById('reportStudentId').value = studentId;

    // Default to last 30 days if dates aren't already set
    if (!document.getElementById('reportStartDate').value) {
        document.getElementById('reportStartDate').valueAsDate = new Date(new Date().setDate(new Date().getDate() - 30));
    }
    if (!document.getElementById('reportEndDate').value) {
        document.getElementById('reportEndDate').valueAsDate = new Date();
    }
    
    generateReport();
}

function deleteStudent(id) {
    if(confirm('Are you sure you want to delete this student?')) {
        fetch(`${API_URL}/students/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(async () => {
            showToast('Student deleted successfully');
            await loadData();
            renderStudents();
        })
        .catch(() => showToast('Failed to delete student', 'error'));
    }
}

function sortStudents(key) {
    if (sortConfig.key === key) {
        sortConfig.asc = !sortConfig.asc;
    } else {
        sortConfig.key = key;
        sortConfig.asc = true;
    }
    renderStudents();
}

function calcStudentAttendance(studentId) {
    let totalDays = 0;
    let presentDays = 0;
    for (const date in appData.attendance) {
        if (appData.attendance[date].hasOwnProperty(studentId)) {
            totalDays++;
            const record = appData.attendance[date][studentId];
            const status = typeof record === 'object' ? record.status : record;
            if (status === 'present' || status === 'late') presentDays++;
        }
    }
    if (totalDays === 0) return { pct: 0, text: 'N/A' };
    const pct = Math.round((presentDays / totalDays) * 100);
    return { pct, text: `${pct}%` };
}

function renderStudents() {
    const query = document.getElementById('studentSearch').value.toLowerCase();
    const tbody = document.getElementById('studentTableBody');
    const emptyState = document.getElementById('emptyStudentsState');
    
    let filtered = appData.students.filter(s => 
        s.name.toLowerCase().includes(query) || 
        s.rollno.toLowerCase().includes(query) ||
        s.class.toLowerCase().includes(query) ||
        (s.year && s.year.toLowerCase().includes(query))
    );

    if (sortConfig.key) {
        filtered.sort((a, b) => {
            let valA = a[sortConfig.key].toLowerCase();
            let valB = b[sortConfig.key].toLowerCase();
            if (sortConfig.key === 'rollno') {
                // try numeric sort
                const numA = parseInt(valA, 10);
                const numB = parseInt(valB, 10);
                if(!isNaN(numA) && !isNaN(numB)) {
                    return sortConfig.asc ? numA - numB : numB - numA;
                }
            }
            if (valA < valB) return sortConfig.asc ? -1 : 1;
            if (valA > valB) return sortConfig.asc ? 1 : -1;
            return 0;
        });
    }

    if (appData.students.length === 0) {
        tbody.innerHTML = '';
        emptyState.classList.remove('hidden');
        emptyState.parentElement.querySelector('table').classList.add('hidden');
        return;
    } else {
        emptyState.classList.add('hidden');
        emptyState.parentElement.querySelector('table').classList.remove('hidden');
    }

    tbody.innerHTML = '';
    filtered.forEach(s => {
        const att = calcStudentAttendance(s.id);
        const pctClass = att.pct > 0 && att.pct < 75 ? 'text-red-500 font-bold' : (att.pct >= 75 ? 'text-green-500 font-bold' : '');

        const tr = document.createElement('tr');
        tr.className = 'border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors';
        tr.innerHTML = `
            <td class="p-4">${s.rollno}</td>
            <td class="p-4 font-medium text-primary-600 dark:text-primary-400 cursor-pointer hover:underline" onclick="viewStudentProfile('${s.id}')">${s.name}</td>
            <td class="p-4">
                <span class="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-1 rounded text-xs font-semibold">
                    ${s.class}
                </span>
            </td>
            <td class="p-4 text-sm font-medium text-gray-600 dark:text-gray-300">${s.year || '-'}</td>
            <td class="p-4 text-sm text-gray-500 dark:text-gray-400">${s.contact || '-'}</td>
            <td class="p-4"><span class="${pctClass}">${att.text}</span></td>
            <td class="p-4 text-center space-x-2">

                <button onclick="editStudent('${s.id}')" class="w-8 h-8 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors" title="Edit">
                    <i class="fa-solid fa-pen-to-square text-sm"></i>
                </button>
                <button onclick="deleteStudent('${s.id}')" class="w-8 h-8 rounded bg-red-50 dark:bg-red-900/20 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors" title="Delete">
                    <i class="fa-solid fa-trash text-sm"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- Attendance Tracking ---
function getSelectedDate() {
    return document.getElementById('attendanceDate').value;
}

function updateAttendanceClassFilter() {
    const filter = document.getElementById('attendanceClassFilter');
    const currentVal = filter.value;
    const classes = [...new Set(appData.students.map(s => s.class))].sort();
    
    filter.innerHTML = '<option value="all">All Classes</option>';
    classes.forEach(c => {
        filter.innerHTML += `<option value="${c}">${c}</option>`;
    });
    
    if([...filter.options].some(o => o.value === currentVal)) {
        filter.value = currentVal;
    }
}

function renderAttendance() {
    updateAttendanceClassFilter();
    const date = getSelectedDate();
    const classFilter = document.getElementById('attendanceClassFilter').value;
    const grid = document.getElementById('attendanceGrid');
    const emptyState = document.getElementById('emptyAttendanceState');
    const banner = document.getElementById('attendanceSummaryBanner');
    
    if (!date) return;

    if (!appData.attendance[date]) {
        appData.attendance[date] = {};
    }

    let filteredStudents = appData.students;
    if (classFilter !== 'all') {
        filteredStudents = filteredStudents.filter(s => s.class === classFilter);
    }

    if (appData.students.length === 0) {
        grid.innerHTML = '';
        banner.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    } else {
        emptyState.classList.add('hidden');
        banner.classList.remove('hidden');
    }

    grid.innerHTML = '';
    let markedCount = 0;

    filteredStudents.forEach(s => {
        const record = appData.attendance[date][s.id];
        const status = record ? (typeof record === 'object' ? record.status : record) : null;
        if (status) markedCount++;

        const card = document.createElement('div');
        card.className = 'bg-white dark:bg-dark-card rounded-xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col gap-4 relative overflow-hidden group';
        
        // Status indicator line
        let statusColor = 'bg-gray-200 dark:bg-gray-700';
        if (status === 'present') statusColor = 'bg-green-500';
        if (status === 'absent') statusColor = 'bg-red-500';
        if (status === 'late') statusColor = 'bg-yellow-500';
        
        card.innerHTML = `
            <div class="absolute left-0 top-0 bottom-0 w-1 ${statusColor} transition-colors duration-300"></div>
            
            <div class="flex justify-between items-start pl-2">
                <div>
                    <h4 class="font-bold text-gray-800 dark:text-gray-100 truncate w-40" title="${s.name}">${s.name}</h4>
                    <span class="text-xs text-gray-500 mr-2">Roll: ${s.rollno}</span>
                    <span class="text-[10px] uppercase font-bold text-primary-600 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-400 px-1.5 py-0.5 rounded">${s.class}</span>
                </div>
                ${appData.attendance[date][s.id] ? '<i class="fa-solid fa-circle-check text-green-500 text-sm opacity-50"></i>' : ''}
            </div>

            <div class="flex gap-2 mt-auto pl-2">
                <button onclick="markStatus('${s.id}', 'present')" class="status-btn flex-1 py-1.5 rounded text-xs font-semibold border border-green-200 dark:border-green-800/40 ${status === 'present' ? 'bg-green-500 text-white border-green-500 selected' : 'text-green-600 bg-green-50 hover:bg-green-100 dark:bg-green-900/10 dark:hover:bg-green-900/30 dark:text-green-500'}">
                    P
                </button>
                <button onclick="markStatus('${s.id}', 'absent')" class="status-btn flex-1 py-1.5 rounded text-xs font-semibold border border-red-200 dark:border-red-800/40 ${status === 'absent' ? 'bg-red-500 text-white border-red-500 selected' : 'text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/10 dark:hover:bg-red-900/30 dark:text-red-500'}">
                    A
                </button>
                <button onclick="markStatus('${s.id}', 'late')" class="status-btn flex-1 py-1.5 rounded text-xs font-semibold border border-yellow-200 dark:border-yellow-800/40 ${status === 'late' ? 'bg-yellow-500 text-white border-yellow-500 selected' : 'text-yellow-600 bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-900/10 dark:hover:bg-yellow-900/30 dark:text-yellow-500'}">
                    L
                </button>
            </div>
        `;
        grid.appendChild(card);
    });

    document.getElementById('attMarkedCount').textContent = markedCount;
    document.getElementById('attTotalCount').textContent = filteredStudents.length;
}

// --- Attendance Action Helper ---
async function parentAlertDelay(studentId, sName, minutesLate, timeStr) {
    const parentMsg = `Attendance Alert: Your child ${sName} arrived ${minutesLate} minute${minutesLate !== 1 ? 's' : ''} late today at ${timeStr}.`;
    
    // Trigger desktop UI alert
    showToast(`LATE ALERT: ${sName} is ${minutesLate}m late - Alert sent to parents!`, "warning");
    
    // Call server to send alert
    try {
        await fetch(`${API_URL}/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentId: studentId, studentName: sName, message: parentMsg })
        });
    } catch(e) {
        console.error("Failed to ping notification server");
    }
}

function markStatus(studentId, status, manualTime = null) {
    const date = getSelectedDate();
    let timeStr = manualTime || new Date().toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'});
    let finalStatus = status;

    // Time checks for automatic recognition overriding (8:30 to 9:00 boundary)
    // Only apply logic if naturally marking "present" and it wasn't already hardcoded to 'late'/'absent'
    if (status === 'present') {
        const now = new Date();
        const hour = now.getHours();
        const min = now.getMinutes();
        
        // Late if after 9:00 AM (09:00)
        if (hour > 9 || (hour === 9 && min > 0)) {
            finalStatus = 'late';
            
            // Calculate minutes late (from 9:00 AM)
            const minutesLate = ((hour * 60) + min) - (9 * 60);
            
            const student = appData.students.find(s => s.id === studentId);
            if (student) parentAlertDelay(studentId, student.name, minutesLate, timeStr);
        }
    }

    // Optimistic UI update
    if (!appData.attendance[date]) appData.attendance[date] = {};
    appData.attendance[date][studentId] = { status: finalStatus, time: timeStr };
    updateDashboard(); // update numbers immediately locally
    
    fetch(`${API_URL}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, studentId, status: finalStatus, time: timeStr })
    })
    .catch(() => {
        showToast('Failed to save attendance', 'error');
    });
    
    // Only redraw everything if not in the middle of Live Rec
    if (currentTab === 'attendance') renderAttendance();
}

async function markAllPresent() {
    const date = getSelectedDate();
    const classFilter = document.getElementById('attendanceClassFilter').value;
    if(!date || appData.students.length === 0) return;

    if (!appData.attendance[date]) appData.attendance[date] = {};

    let count = 0;
    const promises = [];
    appData.students.forEach(s => {
        if (classFilter === 'all' || s.class === classFilter) {
            appData.attendance[date][s.id] = 'present';
            count++;
            
            promises.push(fetch(`${API_URL}/attendance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date, studentId: s.id, status: 'present' })
            }));
        }
    });

    await Promise.all(promises);

    updateDashboard();
    renderAttendance();
    showToast(`Marked ${count} students as Present`);
}

// --- Dashboard & Charts ---
function updateDashboard() {
    // Stats
    const total = appData.students.length;
    document.getElementById('statTotalStudents').textContent = total;

    const today = new Date().toISOString().split('T')[0];
    let present = 0, absent = 0, late = 0;

    if (appData.attendance[today]) {
        Object.values(appData.attendance[today]).forEach(record => {
            const st = typeof record === 'object' ? record.status : record;
            if (st === 'present') present++;
            else if (st === 'absent') absent++;
            else if (st === 'late') late++;
        });
    }

    // Animate numbers
    animateValue("statPresentToday", 0, present, 500);
    animateValue("statAbsentToday", 0, absent, 500);
    animateValue("statLateToday", 0, late, 500);

    // Common Chart Options
    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? '#334155' : '#f1f5f9';

    // Today's Chart (Pie)
    const ctxToday = document.getElementById('todayChart').getContext('2d');
    if (charts.today) charts.today.destroy();
    
    if (total === 0 || (present === 0 && absent === 0 && late === 0)) {
        // Empty state
        charts.today = new Chart(ctxToday, {
            type: 'doughnut',
            data: {
                labels: ['No Data'],
                datasets: [{ data: [1], backgroundColor: [gridColor], borderWidth: 0 }]
            },
            options: { plugins: { legend: { display: false }, tooltip: { enabled: false } }, cutout: '70%', responsive: true, maintainAspectRatio: false }
        });
    } else {
        charts.today = new Chart(ctxToday, {
            type: 'doughnut',
            data: {
                labels: ['Present', 'Absent', 'Late'],
                datasets: [{
                    data: [present, absent, late],
                    backgroundColor: ['#22c55e', '#ef4444', '#eab308'],
                    borderWidth: isDark ? 2 : 2,
                    borderColor: isDark ? '#1e293b' : '#ffffff'
                }]
            },
            options: {
                cutout: '65%',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: textColor, padding: 20, usePointStyle: true, pointStyle: 'circle' } }
                }
            }
        });
    }

    // Weekly Trend (Bar)
    const ctxTrend = document.getElementById('trendChart').getContext('2d');
    if (charts.trend) charts.trend.destroy();

    const last7Days = [];
    const pData = [], aData = [], lData = [];
    
    for(let i=6; i>=0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dStr = d.toISOString().split('T')[0];
        last7Days.push(d.toLocaleDateString('en-US', {weekday:'short'}));
        
        let p=0, a=0, l=0;
        if(appData.attendance[dStr]) {
            Object.values(appData.attendance[dStr]).forEach(rec => {
                const st = typeof rec === 'object' ? rec.status : rec;
                if(st === 'present') p++;
                else if(st === 'absent') a++;
                else if(st === 'late') l++;
            });
        }
        pData.push(p); aData.push(a); lData.push(l);
    }

    charts.trend = new Chart(ctxTrend, {
        type: 'bar',
        data: {
            labels: last7Days,
            datasets: [
                { label: 'Present', data: pData, backgroundColor: '#22c55e', borderRadius: 4 },
                { label: 'Absent', data: aData, backgroundColor: '#ef4444', borderRadius: 4 },
                { label: 'Late', data: lData, backgroundColor: '#eab308', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { color: textColor } },
                y: { stacked: true, grid: { color: gridColor }, border: { dash: [4, 4] }, ticks: { color: textColor, stepSize: 1 } }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function animateValue(id, start, end, duration) {
    if (start === end) {
        document.getElementById(id).textContent = end;
        return;
    }
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        document.getElementById(id).textContent = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

// --- Reports ---
function initReportsTab() {
    populateReportStudentSelect();
}

function populateReportStudentSelect() {
    const sel = document.getElementById('reportStudentId');
    sel.innerHTML = '<option value="">-- Choose Student --</option>';
    
    // Sort students by name alphabetically for better UX
    const sorted = [...appData.students].sort((a,b) => a.name.localeCompare(b.name));
    
    sorted.forEach(s => {
        sel.innerHTML += `<option value="${s.id}">${s.name} (${s.rollno})</option>`;
    });
}

function generateReport() {
    const type = document.getElementById('reportType').value;
    const startDate = new Date(document.getElementById('reportStartDate').value);
    const endDate = new Date(document.getElementById('reportEndDate').value);
    const area = document.getElementById('reportOutputArea');
    
    if (isNaN(startDate) || isNaN(endDate) || startDate > endDate) {
        showToast('Invalid date range', 'error');
        return;
    }

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    
    let html = `
        <div class="print-container">
            <div class="text-center mb-6 pb-6 border-b border-gray-100 dark:border-gray-800">
                <h2 class="text-2xl font-bold font-serif uppercase tracking-wider text-primary-600 dark:text-primary-500">Attendify Report</h2>
                <p class="text-gray-500 mt-2">Date Range: ${startStr} to ${endStr}</p>
            </div>
    `;

    if (type === 'class') {
        html += renderClassReport(startDate, endDate);
    } else {
        const studentId = document.getElementById('reportStudentId').value;
        if (!studentId) {
            showToast('Please select a student', 'error');
            return;
        }
        html += renderStudentReport(studentId, startDate, endDate);
    }

    html += `</div>`;
    area.innerHTML = html;
}

function getDatesInRange(start, end) {
    const dates = [];
    let current = new Date(start);
    while (current <= end) {
        dates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
    }
    return dates;
}

function renderClassReport(start, end) {
    const dates = getDatesInRange(start, end);
    let html = `<h3 class="text-xl font-bold mb-4">Class-wise Summary</h3>`;
    
    if(appData.students.length === 0) {
        return html + `<p>No students found.</p>`;
    }

    // Organize by class
    const byClass = {};
    appData.students.forEach(s => {
        if (!byClass[s.class]) byClass[s.class] = { students: [], totalP: 0, totalA: 0, totalL: 0 };
        byClass[s.class].students.push(s);
    });

    for (const c in byClass) {
        let p=0, a=0, l=0;
        let daysChecked = 0;
        
        dates.forEach(d => {
            if (appData.attendance[d]) {
                byClass[c].students.forEach(s => {
                    const rec = appData.attendance[d][s.id];
                    if (rec) {
                        daysChecked++;
                        const st = typeof rec === 'object' ? rec.status : rec;
                        if (st === 'present') p++;
                        if (st === 'absent') a++;
                        if (st === 'late') l++;
                    }
                });
            }
        });

        const totalEntries = p + a + l;
        const pct = totalEntries ? Math.round(((p+l)/totalEntries)*100) : 0;

        html += `
            <div class="mb-8 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-5 border border-gray-100 dark:border-gray-800">
                <div class="flex justify-between items-center mb-4">
                    <h4 class="text-lg font-bold text-gray-700 dark:text-gray-200">Class: ${c}</h4>
                    <span class="px-3 py-1 bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-300 rounded-full text-sm font-bold">Overall: ${pct}%</span>
                </div>
                <div class="grid grid-cols-3 gap-4 text-center">
                    <div class="bg-white dark:bg-dark-card p-3 rounded shadow-sm border border-gray-100 dark:border-gray-700">
                        <div class="text-green-500 font-bold text-2xl">${p}</div>
                        <div class="text-xs text-gray-500 uppercase tracking-wider">Present</div>
                    </div>
                    <div class="bg-white dark:bg-dark-card p-3 rounded shadow-sm border border-gray-100 dark:border-gray-700">
                        <div class="text-red-500 font-bold text-2xl">${a}</div>
                        <div class="text-xs text-gray-500 uppercase tracking-wider">Absent</div>
                    </div>
                    <div class="bg-white dark:bg-dark-card p-3 rounded shadow-sm border border-gray-100 dark:border-gray-700">
                        <div class="text-yellow-500 font-bold text-2xl">${l}</div>
                        <div class="text-xs text-gray-500 uppercase tracking-wider">Late</div>
                    </div>
                </div>
            </div>
        `;
    }
    return html;
}

function renderStudentReport(studentId, start, end) {
    const student = appData.students.find(s => s.id === studentId);
    if (!student) return `<p>Student not found.</p>`;

    const dates = getDatesInRange(start, end);
    let p=0, a=0, l=0;
    let historyHtml = '';

    dates.forEach(d => {
        let status = '-';
        let actTime = '-';
        let statusClass = 'text-gray-400';
        let badgeClass = 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';

        if (appData.attendance[d] && appData.attendance[d][studentId]) {
            const rec = appData.attendance[d][studentId];
            status = typeof rec === 'object' ? rec.status : rec;
            actTime = typeof rec === 'object' && rec.time ? rec.time : 'N/A';
            
            if (status === 'present') { p++; statusClass = 'text-green-500'; badgeClass = 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'; }
            if (status === 'absent') { a++; statusClass = 'text-red-500'; badgeClass = 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'; }
            if (status === 'late') { l++; statusClass = 'text-yellow-500'; badgeClass = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'; }
        }

        historyHtml += `
            <tr class="border-b border-gray-100 dark:border-gray-800">
                <td class="py-2 text-sm">${new Date(d).toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'})}</td>
                <td class="py-2 capitalize font-semibold ${statusClass}">
                    <span class="px-2 py-0.5 rounded text-xs ${badgeClass} inline-flex items-center gap-1">
                        ${status}
                        ${actTime !== 'N/A' && actTime !== '-' ? `<span class="opacity-60 text-[10px] lowercase font-normal">@ ${actTime}</span>` : ''}
                    </span>
                </td>
            </tr>
        `;
    });

    const total = p + a + l;
    const pct = total ? Math.round(((p+l)/total)*100) : 0;

    return `
        <div class="flex items-center gap-4 mb-6 bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
            <div class="w-16 h-16 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-2xl font-bold uppercase">
                ${student.name.charAt(0)}
            </div>
            <div>
                <h3 class="text-xl font-bold text-gray-800 dark:text-gray-100">${student.name}</h3>
                <p class="text-sm text-gray-500">Roll No: ${student.rollno} | Class: ${student.class} | Contact: ${student.contact || 'N/A'}</p>
            </div>
            <div class="ml-auto text-right">
                <div class="text-3xl font-bold ${pct < 75 ? 'text-red-500' : 'text-green-500'}">${pct}%</div>
                <div class="text-xs text-gray-500 uppercase">Attendance</div>
            </div>
        </div>

        <div class="grid grid-cols-3 gap-4 mb-6">
            <div class="bg-green-50 dark:bg-green-900/10 p-4 rounded-lg text-center border border-green-100 dark:border-green-900/20">
                <div class="text-green-600 font-bold text-xl">${p}</div>
                <div class="text-xs text-green-700 dark:text-green-500 uppercase">Present</div>
            </div>
            <div class="bg-red-50 dark:bg-red-900/10 p-4 rounded-lg text-center border border-red-100 dark:border-red-900/20">
                <div class="text-red-600 font-bold text-xl">${a}</div>
                <div class="text-xs text-red-700 dark:text-red-500 uppercase">Absent</div>
            </div>
            <div class="bg-yellow-50 dark:bg-yellow-900/10 p-4 rounded-lg text-center border border-yellow-100 dark:border-yellow-900/20">
                <div class="text-yellow-600 font-bold text-xl">${l}</div>
                <div class="text-xs text-yellow-700 dark:text-yellow-500 uppercase">Late</div>
            </div>
        </div>

        <div>
            <h4 class="font-bold text-gray-700 dark:text-gray-200 mb-3">Daily Breakdown</h4>
            <div class="max-h-64 overflow-y-auto custom-scrollbar pr-2">
                <table class="w-full text-left">
                    ${historyHtml}
                </table>
            </div>
        </div>
    `;
}

// --- Settings & Data ---
function exportData(type) {
    let csv = '';
    let filename = '';

    if (type === 'students') {
        csv = 'ID,RollNo,Name,Class,Year,Contact\n';
        appData.students.forEach(s => {
            csv += `"${s.id}","${s.rollno}","${s.name}","${s.class}","${s.year || ''}","${s.contact}"\n`;
        });
        filename = 'attendify_students.csv';
    } else if (type === 'attendance') {
        csv = 'Date,StudentId,Name,RollNo,Status,Time\n';
        for (const date in appData.attendance) {
            for(const sid in appData.attendance[date]) {
                const s = appData.students.find(x => x.id === sid);
                const sName = s ? s.name : 'Unknown';
                const sRoll = s ? s.rollno : 'Unknown';
                const rec = appData.attendance[date][sid];
                const st = typeof rec === 'object' ? rec.status : rec;
                const tm = typeof rec === 'object' ? rec.time : '';
                csv += `"${date}","${sid}","${sName}","${sRoll}","${st}","${tm}"\n`;
            }
        }
        filename = 'attendify_attendance.csv';
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast(`Exported ${filename}`);
    }
}

function backupData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href",     dataStr     );
    dlAnchorElem.setAttribute("download", `attendify_backup_${new Date().toISOString().split('T')[0]}.json`);
    dlAnchorElem.click();
    showToast('Backup downloaded successfully');
}

function restoreData() {
    const file = document.getElementById('restoreFile').files[0];
    if (!file) {
        showToast('Please select a JSON file to restore', 'warning');
        return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const parsed = JSON.parse(e.target.result);
            if (parsed.students && parsed.attendance) {
                appData = parsed;
                saveData();
                showToast('Data restored successfully!');
                setTimeout(() => location.reload(), 1500);
            } else {
                showToast('Invalid backup file format.', 'error');
            }
        } catch(err) {
            showToast('Failed to parse backup file.', 'error');
        }
    };
    reader.readAsText(file);
}

function clearAllData() {
    appData = { students: [], attendance: {} };
    saveData();
    closeModal('confirmClearModal');
    showToast('All data cleared successfully');
    setTimeout(() => location.reload(), 1000); // Reload to reset entirely
}

// --- Face Recognition Logic ---
async function loadFaceModels() {
    try {
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        faceModelsLoaded = true;
        console.log("Face API Models loaded.");
    } catch(err) {
        console.error("Error loading face models:", err);
        showToast("Error loading Face AI models. Check internet connection.", "error");
    }
}

// -- Registry --

async function startRegCamera() {
    if (!faceModelsLoaded) {
        showToast('Face recognition models are still loading. Please wait...', 'warning');
        return;
    }

    const video = document.getElementById('regFaceVideo');
    const loading = document.getElementById('regFaceLoading');
    const placeholder = document.getElementById('regFacePlaceholder');
    const startBtn = document.getElementById('startRegCameraBtn');
    const captureBtn = document.getElementById('captureFaceBtn');

    try {
        loading.classList.remove('hidden');
        placeholder.classList.add('hidden');
        
        regFaceStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = regFaceStream;
        video.classList.remove('hidden');
        
        video.onloadedmetadata = () => {
            loading.classList.add('hidden');
            startBtn.classList.add('hidden');
            captureBtn.classList.remove('hidden');
            captureBtn.disabled = false;
        };
    } catch(err) {
        loading.classList.add('hidden');
        placeholder.classList.remove('hidden');
        showToast("Camera blocked! Please click the small Camera icon with an 'X' in your browser's top address bar and select 'Always allow'.", "error");
        console.error("Camera access error:", err);
    }
}

async function captureFace() {
    const video = document.getElementById('regFaceVideo');
    const captureBtn = document.getElementById('captureFaceBtn');

    captureBtn.disabled = true;
    captureBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning...';

    const detections = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();

    if (detections) {
        const descArray = Array.from(detections.descriptor);
        document.getElementById('studentFaceDescriptor').value = JSON.stringify(descArray);
        
        const statusText = document.getElementById('faceStatusText');
        statusText.textContent = 'Face captured and saved temporarily. Ensure you click "Save Student".';
        statusText.className = 'text-xs text-green-500 mb-2 font-semibold';
        
        showToast("Face scanned successfully!", "success");
        captureBtn.innerHTML = '<i class="fa-solid fa-check"></i> Scanned Successfully';
        
        // Stop camera after capture
        if (typeof regFaceStream !== 'undefined' && regFaceStream) {
            regFaceStream.getTracks().forEach(track => track.stop());
            regFaceStream = null;
        }
        document.getElementById('regFaceVideo').classList.add('hidden');
        document.getElementById('regFacePlaceholder').classList.remove('hidden');
        document.getElementById('startRegCameraBtn').classList.remove('hidden');
        captureBtn.classList.add('hidden');
    } else {
        showToast("No face detected. Please ensure you are looking straight at the camera.", "error");
        captureBtn.disabled = false;
        captureBtn.innerHTML = '<i class="fa-solid fa-expand"></i> Scan & Save Face';
    }
}

// -- Attendance Scanner --
async function startFaceScanner() {
    if (!faceModelsLoaded) {
        showToast('Face recognition models are still loading...', 'warning');
        return;
    }

    const video = document.getElementById('faceVideo');
    const loading = document.getElementById('faceLoadingIndicator');
    const placeholder = document.getElementById('facePlaceholder');
    const startBtn = document.getElementById('startFaceRecBtn');
    const stopBtn = document.getElementById('stopFaceRecBtn');

    try {
        loading.classList.remove('hidden');
        placeholder.classList.add('hidden');

        faceRecStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = faceRecStream;
        video.classList.remove('hidden');
        
        video.onloadedmetadata = () => {
            loading.classList.add('hidden');
            startBtn.classList.add('hidden');
            stopBtn.classList.remove('hidden');
            
            // Build labeled descriptors
            const labeledDescriptors = [];
            appData.students.forEach(s => {
                if (s.faceDescriptor) {
                    labeledDescriptors.push(
                        new faceapi.LabeledFaceDescriptors(
                            s.id,
                            [new Float32Array(s.faceDescriptor)]
                        )
                    );
                }
            });

            if (labeledDescriptors.length === 0) {
                showToast("No students have registered faces. Please register faces in Students tab first.", "warning");
                // Stop it
                stopFaceScanner();
                return;
            }

            const faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6); // 0.6 threshold

            // Start processing loop
            const canvas = document.getElementById('faceCanvas');
            const displaySize = { width: video.videoWidth, height: video.videoHeight };
            faceapi.matchDimensions(canvas, displaySize);
            
            faceInterval = setInterval(async () => {
                const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptors();
                const resizedDetections = faceapi.resizeResults(detections, displaySize);
                
                canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
                // Optional: draw boxes
                // faceapi.draw.drawDetections(canvas, resizedDetections);
                
                const results = resizedDetections.map(d => faceMatcher.findBestMatch(d.descriptor));
                
                results.forEach(result => {
                    const studentId = result.label;
                    if (studentId !== 'unknown') {
                        markAttendanceByFace(studentId);
                    }
                });
            }, 1000); // Check every second
        };
    } catch(err) {
        loading.classList.add('hidden');
        placeholder.classList.remove('hidden');
        showToast("Camera blocked! Please click the small Camera icon with an 'X' in your browser's top address bar to allow access.", "error");
        console.error("Scanner camera error:", err);
    }
}

function stopFaceScanner() {
    if (faceInterval) clearInterval(faceInterval);
    if (faceRecStream) {
        faceRecStream.getTracks().forEach(track => track.stop());
        faceRecStream = null;
    }
    document.getElementById('faceVideo').classList.add('hidden');
    document.getElementById('facePlaceholder').classList.remove('hidden');
    document.getElementById('startFaceRecBtn').classList.remove('hidden');
    document.getElementById('stopFaceRecBtn').classList.add('hidden');
    
    const canvas = document.getElementById('faceCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

let recentFaces = [];

function markAttendanceByFace(studentId) {
    const date = new Date().toISOString().split('T')[0];
    
    // Prevent duplicate triggers in rapid succession
    if (recentFaces.includes(studentId)) return;
    
    const student = appData.students.find(s => s.id === studentId);
    if (!student) return;

    if (!appData.attendance[date]) appData.attendance[date] = {};
    
    // Check if recorded today at all yet
    const existing = appData.attendance[date][studentId];
    
    // If not already present/late today
    if (!existing || (existing.status !== 'present' && existing.status !== 'late')) {
        // markStatus internally checks time and changes to late if needed
        markStatus(studentId, 'present');
        showToast(`${student.name} Scanned!`, "success");
    }

    // Add to recent list visually
    recentFaces.push(studentId);
    setTimeout(() => {
        recentFaces = recentFaces.filter(id => id !== studentId);
    }, 5000); // Allow recognizing same person again after 5s

    updateRecentRecognizedUI(student, appData.attendance[date][studentId]);
}

function updateRecentRecognizedUI(student, latestRecord) {
    const list = document.getElementById('recentRecognizedList');
    // Remove "no faces" text if exists
    if (list.querySelector('.italic')) list.innerHTML = '';
    
    const isLate = latestRecord && latestRecord.status === 'late';
    
    const time = latestRecord && latestRecord.time ? latestRecord.time : new Date().toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'});
    
    const item = document.createElement('div');
    item.className = `border rounded-xl p-4 flex items-center gap-3 animate-pulse ${isLate ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800/40' : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/40'}`;
    item.innerHTML = `
        <div class="w-10 h-10 rounded-full ${isLate ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-800/50 dark:text-yellow-400' : 'bg-green-100 text-green-600 dark:bg-green-800/50 dark:text-green-400'} flex items-center justify-center font-bold">
            ${student.name.charAt(0)}
        </div>
        <div>
            <p class="font-bold text-gray-800 dark:text-gray-200 text-sm">${student.name}</p>
            <p class="text-xs ${isLate ? 'text-yellow-600 dark:text-yellow-500' : 'text-green-600 dark:text-green-500'} uppercase font-bold tracking-wider">${isLate ? 'LATE' : 'Present'} <span class="text-[10px] font-medium lowercase opacity-70 ml-1">@ ${time}</span></p>
        </div>
    `;
    
    list.prepend(item);
    setTimeout(() => {
        item.classList.remove('animate-pulse');
    }, 1000);
    
    // Keep max 8 items
    if (list.children.length > 8) {
        list.removeChild(list.lastChild);
    }
}
