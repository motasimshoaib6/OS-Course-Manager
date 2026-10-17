/* =========================================================
   OS Course Manager - script.js
   Plain (vanilla) JavaScript. No libraries, no server, no internet needed.
   All course data is saved in the browser's localStorage.

   Sections in this file:
    1. Settings and small helper functions
    2. HTML sanitizer (keeps lesson content safe)
    3. Course data: empty course, sample course, validation
    4. Saving and loading (localStorage)
    5. App state, messages and confirmation dialog
    6. Router (decides which page is shown, based on the URL "#...")
    7. Page renderers (dashboard, weeks, topic, assignments, search, data)
    8. Dialog forms (week, topic, assignment)
    9. Button actions (one place for every data-action button)
   10. Lesson content editor
   11. Backup: export, import, sample data, empty course
   12. Event wiring and start-up
   ========================================================= */

'use strict';

/* =========================================================
   1. SETTINGS AND HELPERS
   ========================================================= */

const STORAGE_KEY = 'osCourseManager.data';   // localStorage key for all data
const SCHEMA_VERSION = 1;                      // increase if the data format changes
const TOPIC_STATUSES = ['pending', 'completed'];
const ASSIGNMENT_STATUSES = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  'submitted': 'Submitted',
  'graded': 'Graded'
};
const LIMITS = {
  courseTitle: 120,
  semester: 80,
  title: 150,
  description: 5000,
  maxWeekNumber: 99
};
const MAX_IMPORT_BYTES = 30 * 1024 * 1024;     // 30 MB backup file limit
const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per chosen image
const MAX_IMAGE_WIDTH = 1200;                  // larger images are scaled down

/** Shortcut for document.querySelector */
function $(selector, root = document) {
  return root.querySelector(selector);
}

/** Escapes text so it is shown as text, never run as HTML. */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Collects every id already used, so new ids are always unique. */
function collectAllIds(data) {
  const ids = new Set();
  if (!data) return ids;
  data.weeks.forEach(week => {
    ids.add(week.id);
    week.topics.forEach(topic => ids.add(topic.id));
  });
  data.assignments.forEach(a => ids.add(a.id));
  return ids;
}

/** Creates a unique id such as "week_lq2k3x9a8b7c". */
function createId(prefix) {
  const used = collectAllIds(state.data);
  let id;
  do {
    let random;
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      random = Array.from(window.crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('');
    } else {
      random = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
    id = prefix + '_' + Date.now().toString(36) + random;
  } while (used.has(id));
  return id;
}

/** Checks a "YYYY-MM-DD" date string (the format used by <input type="date">). */
function isValidDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function parseLocalDate(text) {
  const [y, m, d] = text.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDateString(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

function todayString() {
  return toDateString(new Date());
}

function addDays(dateText, days) {
  const date = parseLocalDate(dateText);
  date.setDate(date.getDate() + days);
  return toDateString(date);
}

/** "2026-10-18" -> "Oct 18, 2026" (format depends on your computer's language). */
function formatDate(text) {
  if (!isValidDate(text)) return '';
  return parseLocalDate(text).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(iso) {
  const date = new Date(iso);
  if (!iso || isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Whole days from today until the date (negative = in the past). */
function daysUntil(dateText) {
  const today = parseLocalDate(todayString());
  return Math.round((parseLocalDate(dateText) - today) / 86400000);
}

function plural(count, word) {
  return count + ' ' + word + (count === 1 ? '' : 's');
}

function truncate(text, max) {
  const clean = String(text || '').trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
}

/* =========================================================
   2. HTML SANITIZER
   Lesson content is stored as HTML (so it can have headings, tables...).
   Before content is saved or shown, it is rebuilt here using an
   "allow list": only harmless tags/attributes survive. Scripts, event
   handlers (onclick=...), styles, iframes and "javascript:" links are
   removed, so user content is never executed.
   ========================================================= */

const Sanitizer = (() => {
  const ALLOWED_TAGS = new Set([
    'P', 'BR', 'H2', 'H3', 'H4', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUB', 'SUP', 'MARK',
    'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION',
    'PRE', 'CODE', 'BLOCKQUOTE', 'IMG', 'A', 'DIV', 'HR', 'FIGURE', 'FIGCAPTION'
  ]);
  // These tags are removed together with everything inside them.
  const DROP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'SVG', 'MATH',
    'TEMPLATE', 'NOSCRIPT', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION', 'LINK',
    'META', 'TITLE', 'HEAD', 'BASE', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'CANVAS', 'MAP', 'AREA', 'XML'
  ]);
  // Tags converted into allowed equivalents.
  const RENAME_TAGS = { H1: 'H2', H5: 'H4', H6: 'H4', STRIKE: 'S', DEL: 'S', INS: 'U' };
  const CALLOUT_CLASSES = new Set(['callout', 'callout-important', 'callout-example', 'callout-note', 'callout-problem', 'callout-homework']);
  const SAFE_DATA_IMAGE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
  const SAFE_IMAGE_URL = /^https?:\/\/[^\s"'<>]+$/i;
  const SAFE_LINK = /^(https?:\/\/|mailto:)[^\s"'<>]+$/i;

  function copySafeAttributes(source, target, tag) {
    if (tag === 'A') {
      const href = (source.getAttribute('href') || '').trim();
      if (SAFE_LINK.test(href)) {
        target.setAttribute('href', href);
        target.setAttribute('target', '_blank');
        target.setAttribute('rel', 'noopener noreferrer');
      }
    } else if (tag === 'IMG') {
      const src = (source.getAttribute('src') || '').trim();
      if (!SAFE_DATA_IMAGE.test(src) && !SAFE_IMAGE_URL.test(src)) return false; // drop unsafe image
      target.setAttribute('src', src);
      target.setAttribute('alt', truncate(source.getAttribute('alt') || '', 200));
    } else if (tag === 'TD' || tag === 'TH') {
      ['colspan', 'rowspan'].forEach(name => {
        const value = source.getAttribute(name);
        if (value && /^\d{1,2}$/.test(value) && Number(value) > 1) target.setAttribute(name, value);
      });
    } else if (tag === 'DIV') {
      const classes = (source.getAttribute('class') || '').split(/\s+/).filter(c => CALLOUT_CLASSES.has(c));
      if (classes.includes('callout') && classes.length > 1) target.setAttribute('class', classes.join(' '));
    } else if (tag === 'OL') {
      const start = source.getAttribute('start');
      if (start && /^\d{1,4}$/.test(start)) target.setAttribute('start', start);
    }
    return true;
  }

  function cleanChildren(sourceParent, targetParent, doc) {
    Array.from(sourceParent.childNodes).forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        targetParent.appendChild(doc.createTextNode(node.data));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return; // comments etc. are dropped

      let tag = node.tagName.toUpperCase();
      if (tag.includes(':')) { cleanChildren(node, targetParent, doc); return; } // e.g. Word's <o:p>
      if (DROP_TAGS.has(tag)) return;
      tag = RENAME_TAGS[tag] || tag;

      if (!ALLOWED_TAGS.has(tag)) {
        // Unknown but harmless tag (span, font, section...): keep only its contents.
        cleanChildren(node, targetParent, doc);
        return;
      }
      const clean = doc.createElement(tag.toLowerCase());
      if (!copySafeAttributes(node, clean, tag)) return;
      if (tag !== 'IMG' && tag !== 'BR' && tag !== 'HR') cleanChildren(node, clean, doc);
      targetParent.appendChild(clean);
    });
  }

  /** Returns a safe HTML string. Never throws. */
  function sanitize(html) {
    if (typeof html !== 'string' || html.trim() === '') return '';
    try {
      // DOMParser creates an inert document: nothing in it runs or loads.
      const parsed = new DOMParser().parseFromString('<!DOCTYPE html><html><body>' + html + '</body></html>', 'text/html');
      const output = parsed.createElement('div');
      cleanChildren(parsed.body, output, parsed);
      return output.innerHTML;
    } catch (err) {
      console.error('Sanitizer failed', err);
      return '<p>' + esc(html) + '</p>';
    }
  }

  /** Plain text version of HTML, used for search and empty checks. */
  function toText(html) {
    if (!html) return '';
    const spaced = html.replace(/<\/?(p|h[1-6]|li|td|th|div|pre|tr|br|hr|figcaption|blockquote|caption)\b[^>]*>/gi, ' $& ');
    const parsed = new DOMParser().parseFromString('<body>' + spaced + '</body>', 'text/html');
    return (parsed.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /** True when the content has no text, images, tables, code or lines. */
  function isEmpty(html) {
    if (!html) return true;
    if (/<(img|table|pre|hr)\b/i.test(html)) return false;
    return toText(html) === '';
  }

  return { sanitize, toText, isEmpty };
})();

/* =========================================================
   3. COURSE DATA
   Data format (saved as JSON):
   {
     schemaVersion: 1,
     course: { title, semester },
     weeks: [ { id, number, title, date, description,
                topics: [ { id, title, status, content, updatedAt } ] } ],
     assignments: [ { id, title, description, dueDate, status, weekId } ],
     meta: { createdAt, updatedAt, lastExportAt }
   }
   ========================================================= */

function createEmptyData(title = 'Operating Systems') {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    course: { title, semester: '' },
    weeks: [],
    assignments: [],
    meta: { createdAt: now, updatedAt: now, lastExportAt: '' }
  };
}

/** Builds a realistic sample course so every feature can be tried at once. */
function createSampleData() {
  const data = createEmptyData('Operating Systems');
  data.course.semester = 'BS Computer Science';
  const now = new Date().toISOString();
  const start = addDays(todayString(), -21);
  const used = new Set();
  const id = prefix => {
    let value;
    do { value = prefix + '_s' + Math.random().toString(36).slice(2, 12); } while (used.has(value));
    used.add(value);
    return value;
  };
  const topic = (title, status, content) => ({ id: id('topic'), title, status, content: Sanitizer.sanitize(content), updatedAt: now });
  const week = (number, title, description, topics) => ({
    id: id('week'), number, title, date: addDays(start, (number - 1) * 7), description, topics
  });

  data.weeks = [
    week(1, 'Introduction to Operating Systems',
      'What an operating system is, what it does, computer system organisation and system calls.', [
        topic('What is an Operating System?', 'completed', `
          <h2>Definition</h2>
          <p>An <strong>operating system (OS)</strong> is software that manages the computer hardware and provides services to application programs. It acts as an intermediary between the user and the hardware.</p>
          <h3>Goals of an operating system</h3>
          <ul>
            <li>Execute user programs and make solving user problems easier</li>
            <li>Make the computer system convenient to use</li>
            <li>Use the computer hardware in an efficient manner</li>
          </ul>
          <div class="callout callout-important"><p>The OS is both a <strong>resource allocator</strong> (CPU time, memory, files, I/O devices) and a <strong>control program</strong> (prevents errors and improper use of the computer).</p></div>
          <h3>Common operating systems</h3>
          <ol>
            <li>Windows</li>
            <li>Linux (Ubuntu, Fedora, Debian)</li>
            <li>macOS</li>
            <li>Android and iOS</li>
          </ol>
          <div class="callout callout-example"><p>When you double-click a program, the OS finds it on disk, loads it into memory, creates a <em>process</em> and schedules it to run on the CPU.</p></div>`),
        topic('Computer System Organisation', 'completed', `
          <h2>Main components</h2>
          <table>
            <thead><tr><th>Component</th><th>Role</th></tr></thead>
            <tbody>
              <tr><td>CPU</td><td>Executes instructions</td></tr>
              <tr><td>Main memory (RAM)</td><td>Holds running programs and their data</td></tr>
              <tr><td>Storage (HDD/SSD)</td><td>Keeps data permanently</td></tr>
              <tr><td>I/O devices</td><td>Keyboard, display, network card, etc.</td></tr>
            </tbody>
          </table>
          <h3>Interrupts</h3>
          <p>An <strong>interrupt</strong> is a signal that tells the CPU an event needs attention (for example, a key was pressed). The CPU saves its state, runs an <em>interrupt handler</em>, then continues.</p>
          <div class="callout callout-note"><p>Dual-mode operation (<code>user mode</code> and <code>kernel mode</code>) protects the OS from faulty or malicious programs.</p></div>`),
        topic('System Calls', 'pending', `
          <h2>What is a system call?</h2>
          <p>A <strong>system call</strong> is the way a program asks the operating system kernel to do something on its behalf, such as reading a file or creating a process.</p>
          <h3>Example: creating a process in C</h3>
          <pre><code>#include &lt;stdio.h&gt;
#include &lt;unistd.h&gt;

int main(void) {
    pid_t pid = fork();   /* system call: create a new process */

    if (pid == 0) {
        printf("Hello from the child process\\n");
    } else {
        printf("Parent: my child has PID %d\\n", pid);
    }
    return 0;
}</code></pre>
          <h3>Types of system calls</h3>
          <ul>
            <li>Process control: <code>fork()</code>, <code>exec()</code>, <code>exit()</code></li>
            <li>File management: <code>open()</code>, <code>read()</code>, <code>write()</code>, <code>close()</code></li>
            <li>Device management, information maintenance, communication</li>
          </ul>
          <div class="callout callout-homework"><p>Run the program above on Linux (or WSL on Windows) and explain why the output order can change between runs.</p></div>`)
      ]),
    week(2, 'Processes',
      'The process concept, process states, the Process Control Block (PCB) and inter-process communication.', [
        topic('Process Concept and States', 'completed', `
          <h2>What is a process?</h2>
          <p>A <strong>process</strong> is a program in execution. A program is passive (a file on disk); a process is active.</p>
          <h3>Process states</h3>
          <table>
            <thead><tr><th>State</th><th>Meaning</th></tr></thead>
            <tbody>
              <tr><td>New</td><td>The process is being created</td></tr>
              <tr><td>Ready</td><td>Waiting to be assigned to the CPU</td></tr>
              <tr><td>Running</td><td>Instructions are being executed</td></tr>
              <tr><td>Waiting</td><td>Waiting for an event such as I/O</td></tr>
              <tr><td>Terminated</td><td>The process has finished</td></tr>
            </tbody>
          </table>
          <h3>Process Control Block (PCB)</h3>
          <p>The OS keeps a PCB for every process. It stores the process state, program counter, CPU registers, scheduling information, memory information and open files.</p>`),
        topic('Inter-Process Communication (IPC)', 'pending', `
          <h2>Two main models</h2>
          <ol>
            <li><strong>Shared memory</strong> - processes read and write a shared region of memory.</li>
            <li><strong>Message passing</strong> - processes exchange messages through the OS (e.g. pipes, sockets).</li>
          </ol>
          <div class="callout callout-problem"><p>Give one advantage and one disadvantage of shared memory compared with message passing.</p></div>`)
      ]),
    week(3, 'Threads and Concurrency',
      'Threads, multithreading models and thread libraries.', [
        topic('Threads and Multithreading Models', 'pending', `
          <h2>Why threads?</h2>
          <p>A <strong>thread</strong> is the basic unit of CPU use inside a process. Threads of the same process share code, data and open files, but each has its own registers and stack.</p>
          <h3>Multithreading models</h3>
          <ul>
            <li>Many-to-One</li>
            <li>One-to-One</li>
            <li>Many-to-Many</li>
          </ul>`)
      ]),
    week(4, 'CPU Scheduling',
      'Scheduling criteria and algorithms: FCFS, SJF, Priority and Round Robin.', [
        topic('Scheduling Algorithms', 'pending', `
          <h2>Scheduling criteria</h2>
          <p>CPU utilisation, throughput, turnaround time, waiting time and response time.</p>
          <h3>First-Come, First-Served (FCFS)</h3>
          <table>
            <thead><tr><th>Process</th><th>Burst time (ms)</th></tr></thead>
            <tbody>
              <tr><td>P1</td><td>24</td></tr>
              <tr><td>P2</td><td>3</td></tr>
              <tr><td>P3</td><td>3</td></tr>
            </tbody>
          </table>
          <div class="callout callout-example"><p>Order P1, P2, P3: waiting times are 0, 24 and 27, so the average waiting time is (0 + 24 + 27) / 3 = <strong>17 ms</strong>.</p></div>
          <div class="callout callout-problem"><p>Calculate the average waiting time if the processes arrive in the order P2, P3, P1.</p></div>
          <div class="callout callout-important"><p>FCFS can cause the <strong>convoy effect</strong>: short processes wait behind one long process.</p></div>`)
      ]),
    week(5, 'Process Synchronisation',
      'The critical-section problem, mutex locks and semaphores.', [
        topic('The Critical-Section Problem', 'pending', ''),
        topic('Semaphores and Mutex Locks', 'pending', '')
      ])
  ];

  data.assignments = [
    { id: id('asg'), title: 'Lab 1: Process creation with fork()', description: 'Write a C program that creates two child processes and prints their PIDs. Submit the source code and a screenshot of the output.', dueDate: addDays(todayString(), -3), status: 'submitted', weekId: data.weeks[0].id },
    { id: id('asg'), title: 'Quiz 1 preparation', description: 'Revise Weeks 1 and 2: OS definition, system calls and process states.', dueDate: addDays(todayString(), 3), status: 'not-started', weekId: data.weeks[1].id },
    { id: id('asg'), title: 'Assignment 1: CPU scheduling problems', description: 'Solve FCFS, SJF and Round Robin (quantum = 4 ms) problems. Draw a Gantt chart for each and calculate the average waiting time.', dueDate: addDays(todayString(), 10), status: 'in-progress', weekId: data.weeks[3].id }
  ];
  return data;
}

/**
 * Checks data from localStorage or from an imported file.
 * Returns { ok: true, data } with a cleaned copy, or { ok: false, errors: [...] }.
 * Older data formats are upgraded here (migration) so updates never wipe your data.
 */
function validateCourseData(input) {
  const errors = [];
  const fail = message => { if (errors.length < 12) errors.push(message); };

  if (!isPlainObject(input)) {
    return { ok: false, errors: ['The file does not contain a course backup (expected a JSON object).'] };
  }

  const version = input.schemaVersion === undefined ? 1 : input.schemaVersion;
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, errors: ['"schemaVersion" must be a whole number.'] };
  }
  if (version > SCHEMA_VERSION) {
    return { ok: false, errors: ['This backup was made by a newer version of the app (format ' + version + '). Please update the app first.'] };
  }
  // Future migrations go here, e.g. if (version === 1) { ...convert to version 2... }

  const text = (value, label, { required = false, max = LIMITS.description } = {}) => {
    if (value === undefined || value === null) value = '';
    if (typeof value !== 'string') { fail(label + ' must be text.'); return ''; }
    const trimmed = value.trim();
    if (required && !trimmed) fail(label + ' is required.');
    if (trimmed.length > max) fail(label + ' is too long (maximum ' + max + ' characters).');
    return trimmed;
  };
  const date = (value, label) => {
    if (value === undefined || value === null || value === '') return '';
    if (!isValidDate(value)) { fail(label + ' must be a valid date in YYYY-MM-DD format.'); return ''; }
    return value;
  };
  const seenIds = new Set();
  const checkId = (value, label) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 100) {
      fail(label + ' has a missing or invalid id.');
      return '';
    }
    if (seenIds.has(value)) fail(label + ' uses an id that appears more than once ("' + truncate(value, 30) + '").');
    seenIds.add(value);
    return value;
  };

  // Course
  if (!isPlainObject(input.course)) fail('"course" section is missing.');
  const course = isPlainObject(input.course) ? input.course : {};
  const cleanCourse = {
    title: text(course.title, 'Course title', { required: true, max: LIMITS.courseTitle }),
    semester: text(course.semester, 'Semester', { max: LIMITS.semester })
  };

  // Weeks and topics
  if (!Array.isArray(input.weeks)) fail('"weeks" must be a list.');
  const weekNumbers = new Set();
  const cleanWeeks = (Array.isArray(input.weeks) ? input.weeks : []).map((week, wi) => {
    const label = 'Week #' + (wi + 1);
    if (!isPlainObject(week)) { fail(label + ' is not a valid week.'); return null; }
    const number = week.number;
    if (!Number.isInteger(number) || number < 1 || number > LIMITS.maxWeekNumber) {
      fail(label + ': week number must be a whole number from 1 to ' + LIMITS.maxWeekNumber + '.');
    } else if (weekNumbers.has(number)) {
      fail('Week number ' + number + ' appears more than once.');
    }
    weekNumbers.add(number);
    if (week.topics !== undefined && !Array.isArray(week.topics)) fail(label + ': "topics" must be a list.');
    const topics = (Array.isArray(week.topics) ? week.topics : []).map((topic, ti) => {
      const tLabel = label + ', topic #' + (ti + 1);
      if (!isPlainObject(topic)) { fail(tLabel + ' is not a valid topic.'); return null; }
      const status = topic.status === undefined ? 'pending' : topic.status;
      if (!TOPIC_STATUSES.includes(status)) fail(tLabel + ': status must be "pending" or "completed".');
      if (topic.content !== undefined && typeof topic.content !== 'string') fail(tLabel + ': content must be text.');
      return {
        id: checkId(topic.id, tLabel),
        title: text(topic.title, tLabel + ' title', { required: true, max: LIMITS.title }),
        status,
        content: Sanitizer.sanitize(typeof topic.content === 'string' ? topic.content : ''),
        updatedAt: typeof topic.updatedAt === 'string' ? topic.updatedAt : ''
      };
    });
    return {
      id: checkId(week.id, label),
      number,
      title: text(week.title, label + ' title', { required: true, max: LIMITS.title }),
      date: date(week.date, label + ' date'),
      description: text(week.description, label + ' description'),
      topics
    };
  });

  // Assignments (optional list)
  if (input.assignments !== undefined && !Array.isArray(input.assignments)) fail('"assignments" must be a list.');
  const weekIds = new Set(cleanWeeks.filter(Boolean).map(w => w.id));
  const cleanAssignments = (Array.isArray(input.assignments) ? input.assignments : []).map((a, ai) => {
    const label = 'Assignment #' + (ai + 1);
    if (!isPlainObject(a)) { fail(label + ' is not a valid assignment.'); return null; }
    const status = a.status === undefined ? 'not-started' : a.status;
    if (!Object.prototype.hasOwnProperty.call(ASSIGNMENT_STATUSES, status)) fail(label + ': unknown status "' + truncate(String(status), 20) + '".');
    return {
      id: checkId(a.id, label),
      title: text(a.title, label + ' title', { required: true, max: LIMITS.title }),
      description: text(a.description, label + ' description'),
      dueDate: date(a.dueDate, label + ' due date'),
      status,
      weekId: typeof a.weekId === 'string' && weekIds.has(a.weekId) ? a.weekId : ''
    };
  });

  if (errors.length) return { ok: false, errors };

  const meta = isPlainObject(input.meta) ? input.meta : {};
  const now = new Date().toISOString();
  const data = {
    schemaVersion: SCHEMA_VERSION,
    course: cleanCourse,
    weeks: cleanWeeks,
    assignments: cleanAssignments,
    meta: {
      createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : now,
      updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : now,
      lastExportAt: typeof meta.lastExportAt === 'string' ? meta.lastExportAt : ''
    }
  };
  sortWeeks(data);
  return { ok: true, data };
}

function sortWeeks(data) {
  data.weeks.sort((a, b) => a.number - b.number);
}

/* Finders */
function findWeek(weekId) {
  return state.data.weeks.find(w => w.id === weekId) || null;
}

function findTopic(weekId, topicId) {
  const week = findWeek(weekId);
  if (!week) return null;
  const index = week.topics.findIndex(t => t.id === topicId);
  return index === -1 ? null : { week, topic: week.topics[index], index };
}

function findAssignment(id) {
  return state.data.assignments.find(a => a.id === id) || null;
}

function weekProgress(week) {
  const total = week.topics.length;
  const done = week.topics.filter(t => t.status === 'completed').length;
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

function isAssignmentOpen(a) {
  return a.status === 'not-started' || a.status === 'in-progress';
}

function isAssignmentOverdue(a) {
  return isAssignmentOpen(a) && isValidDate(a.dueDate) && daysUntil(a.dueDate) < 0;
}

/* =========================================================
   4. SAVING AND LOADING (localStorage)
   ========================================================= */

function loadFromStorage() {
  let raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    return { status: 'unavailable', data: createEmptyData(), error: err.message };
  }
  if (raw === null) return { status: 'first-run', data: createSampleData() };

  let parsed;
  let result;
  try {
    parsed = JSON.parse(raw);
    result = validateCourseData(parsed);
  } catch (err) {
    result = { ok: false, errors: ['Saved data is not valid JSON (' + err.message + ').'] };
  }
  if (result.ok) return { status: 'loaded', data: result.data };

  // The saved data is damaged. Keep a copy of it so nothing is lost for good.
  const copyKey = STORAGE_KEY + '.damaged-' + Date.now();
  let copied = false;
  try {
    window.localStorage.setItem(copyKey, raw);
    copied = true;
  } catch (err) {
    copied = false;
  }
  return { status: 'damaged', data: createEmptyData(), errors: result.errors, copyKey, copied };
}

function saveToStorage(data) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return { ok: true };
  } catch (err) {
    const full = err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014);
    return {
      ok: false,
      error: full
        ? 'Not saved: browser storage is full (usually about 5 MB). Remove some large images, or export a backup and delete old content.'
        : 'Not saved: the browser blocked saving (' + (err && err.message ? err.message : 'unknown error') + ').'
    };
  }
}

/* =========================================================
   5. APP STATE, MESSAGES AND CONFIRMATION
   ========================================================= */

const state = {
  data: null,             // the whole course (see section 3)
  route: { name: 'dashboard' },
  currentHash: '',
  editorDirty: false,     // true when the editor has unsaved changes
  memoryOnly: false,      // true if localStorage cannot be used at all
  saveBlocked: false,     // true if damaged data could not be copied safely
  assignmentFilter: { text: '', status: 'all' }
};

/**
 * The ONLY way data is changed. It:
 *  1. remembers a copy of the data,
 *  2. runs your change,
 *  3. saves to localStorage,
 *  4. puts the copy back if anything failed (so the screen never shows unsaved data).
 */
function updateData(change, successMessage) {
  if (state.saveBlocked) {
    toast('Saving is turned off because damaged saved data could not be backed up. See the message at the top of the page.', 'error');
    return false;
  }
  const snapshot = JSON.stringify(state.data);
  try {
    change(state.data);
    state.data.meta.updatedAt = new Date().toISOString();
  } catch (err) {
    state.data = JSON.parse(snapshot);
    console.error(err);
    toast(err.message || 'Something went wrong.', 'error');
    return false;
  }
  if (!state.memoryOnly) {
    const result = saveToStorage(state.data);
    if (!result.ok) {
      state.data = JSON.parse(snapshot);
      toast(result.error, 'error');
      return false;
    }
  }
  if (successMessage) toast(successMessage, 'success');
  return true;
}

/** Replaces all data at once (import, sample data, empty course). */
function replaceAllData(newData, successMessage) {
  const previous = state.data;
  state.data = newData;
  if (!state.memoryOnly) {
    const result = saveToStorage(newData);
    if (!result.ok) {
      state.data = previous;
      toast(result.error, 'error');
      return false;
    }
  }
  state.saveBlocked = false;
  hideBanner();
  toast(successMessage, 'success');
  return true;
}

/** Shows a small message in the bottom-right corner. type: success | error | info */
function toast(message, type = 'success') {
  const container = $('#toastContainer');
  const box = document.createElement('div');
  box.className = 'toast toast-' + type;
  if (type === 'error') box.setAttribute('role', 'alert');
  const text = document.createElement('p');
  text.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss message');
  close.textContent = '×';
  close.addEventListener('click', () => box.remove());
  box.append(text, close);
  container.appendChild(box);
  while (container.children.length > 4) container.firstElementChild.remove();
  setTimeout(() => box.remove(), type === 'error' ? 9000 : 4500);
}

function showBanner(message, type = 'warning') {
  const banner = $('#appBanner');
  banner.className = 'banner banner-' + type;
  banner.textContent = message;
  banner.hidden = false;
}

function hideBanner() {
  $('#appBanner').hidden = true;
}

function openDialog(dialog) {
  if (dialog.open) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

/**
 * Shows an "Are you sure?" dialog. Returns a Promise that resolves to
 * true (confirmed) or false (cancelled / Escape pressed).
 */
function confirmAction({ title, message, confirmText = 'Confirm', danger = true }) {
  return new Promise(resolve => {
    const dialog = $('#confirmDialog');
    $('#confirmTitle').textContent = title;
    $('#confirmMessage').textContent = message;
    const okButton = $('#confirmOk');
    okButton.textContent = confirmText;
    okButton.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    dialog.returnValue = '';
    // Answer as soon as a button is clicked; the "close" event covers the Escape key.
    let answered = false;
    const finish = result => {
      if (answered) return;
      answered = true;
      okButton.removeEventListener('click', onOk);
      cancelButton.removeEventListener('click', onCancel);
      dialog.removeEventListener('close', onClose);
      resolve(result);
    };
    const cancelButton = $('#confirmCancel');
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onClose = () => finish(dialog.returnValue === 'confirm');
    okButton.addEventListener('click', onOk);
    cancelButton.addEventListener('click', onCancel);
    dialog.addEventListener('close', onClose);
    openDialog(dialog);
    $('#confirmCancel').focus();
  });
}

/** Shows error messages under form fields. Returns true if there were errors. */
function showFormErrors(form, errors) {
  form.querySelectorAll('[data-error-for]').forEach(p => { p.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  const names = Object.keys(errors);
  names.forEach(name => {
    const message = form.querySelector('[data-error-for="' + name + '"]');
    if (message) message.textContent = errors[name];
    const field = form.querySelector('[name="' + name + '"]');
    if (field) field.setAttribute('aria-invalid', 'true');
  });
  if (names.length) {
    const first = form.querySelector('[name="' + names[0] + '"]');
    if (first) first.focus();
    return true;
  }
  return false;
}

/* =========================================================
   6. ROUTER
   The part after "#" in the address bar decides the page, e.g.
   #/dashboard, #/week/<id>, #/topic/<weekId>/<topicId>,
   #/edit/<weekId>/<topicId>, #/assignments, #/data, #/search/<text>
   ========================================================= */

const routes = {
  dashboard: () => '#/dashboard',
  weeks: () => '#/weeks',
  week: weekId => '#/week/' + encodeURIComponent(weekId),
  topic: (weekId, topicId) => '#/topic/' + encodeURIComponent(weekId) + '/' + encodeURIComponent(topicId),
  edit: (weekId, topicId) => '#/edit/' + encodeURIComponent(weekId) + '/' + encodeURIComponent(topicId),
  assignments: () => '#/assignments',
  data: () => '#/data',
  search: query => '#/search/' + encodeURIComponent(query)
};

function parseRoute(hash) {
  const clean = (hash || '').replace(/^#\/?/, '');
  const parts = clean.split('/').map(part => {
    try { return decodeURIComponent(part); } catch (err) { return part; }
  });
  switch (parts[0]) {
    case '':
    case 'dashboard': return { name: 'dashboard' };
    case 'weeks': return { name: 'weeks' };
    case 'week': return { name: 'week', weekId: parts[1] || '' };
    case 'topic': return { name: 'topic', weekId: parts[1] || '', topicId: parts[2] || '' };
    case 'edit': return { name: 'edit', weekId: parts[1] || '', topicId: parts[2] || '' };
    case 'assignments': return { name: 'assignments' };
    case 'data': return { name: 'data' };
    case 'search': return { name: 'search', query: parts.slice(1).join('/') };
    default: return { name: 'notfound' };
  }
}

/** Goes to a page. If we are already there, the page is simply redrawn. */
function navigate(hash) {
  if (location.hash === hash) render(false);
  else location.hash = hash;
}

/**
 * Redraws the current page after data changed. On the editor page only the
 * sidebar is redrawn, so text you have not saved yet is never wiped out.
 */
function refresh() {
  if (state.route.name === 'edit') renderSidebar();
  else render(false);
}

function handleHashChange() {
  const newHash = location.hash || routes.dashboard();
  // Protect unsaved editor changes.
  if (state.editorDirty && newHash !== state.currentHash) {
    history.replaceState(null, '', state.currentHash);
    confirmAction({
      title: 'Leave without saving?',
      message: 'You have unsaved changes in this topic. If you leave now, those changes will be lost.',
      confirmText: 'Discard changes'
    }).then(ok => {
      if (ok) {
        state.editorDirty = false;
        location.hash = newHash;
      }
    });
    return;
  }
  render(true);
}

/** Draws the current page. focusHeading=true moves keyboard focus to the new page title. */
function render(focusHeading = false) {
  state.currentHash = location.hash || routes.dashboard();
  const route = parseRoute(location.hash);
  state.route = route;
  const main = $('#main');

  let html;
  switch (route.name) {
    case 'dashboard': html = viewDashboard(); break;
    case 'weeks': html = viewWeeks(); break;
    case 'week': html = viewWeek(route.weekId); break;
    case 'topic': html = viewTopic(route.weekId, route.topicId); break;
    case 'edit': html = viewEditor(route.weekId, route.topicId); break;
    case 'assignments': html = viewAssignments(); break;
    case 'data': html = viewData(); break;
    case 'search': html = viewSearch(route.query); break;
    default: html = viewNotFound();
  }
  main.innerHTML = html;

  if (route.name === 'edit') setupEditor(route.weekId, route.topicId);
  if (route.name === 'assignments') renderAssignmentList();
  if (route.name === 'search') $('#searchInput').value = route.query;

  renderSidebar(route);
  const heading = main.querySelector('h1');
  document.title = (heading ? heading.textContent.trim() + ' - ' : '') + 'OS Course Manager';

  if (focusHeading) {
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    window.scrollTo(0, 0);
    closeSidebar();
  }
}

/* =========================================================
   7. PAGE RENDERERS
   Every function returns an HTML string. All user text goes
   through esc() so it is displayed, never executed.
   ========================================================= */

function breadcrumb(items) {
  return '<nav class="breadcrumb" aria-label="Breadcrumb"><ol>' +
    items.map((item, i) => i === items.length - 1
      ? '<li aria-current="page">' + esc(item.label) + '</li>'
      : '<li><a href="' + item.href + '">' + esc(item.label) + '</a></li>').join('') +
    '</ol></nav>';
}

function progressBar(percent, label) {
  return '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '" aria-label="' + esc(label) + '">' +
    '<div class="progress-bar" style="width:' + percent + '%"></div></div>';
}

function weekLabel(week) {
  return 'Week ' + week.number + ': ' + week.title;
}

function viewDashboard() {
  const { course, weeks, assignments } = state.data;
  const totalTopics = weeks.reduce((sum, w) => sum + w.topics.length, 0);
  const completed = weeks.reduce((sum, w) => sum + weekProgress(w).done, 0);
  const percent = totalTopics ? Math.round((completed / totalTopics) * 100) : 0;
  const openAssignments = assignments.filter(isAssignmentOpen);
  const overdue = assignments.filter(isAssignmentOverdue).length;
  const upcoming = openAssignments
    .slice()
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    .slice(0, 5);

  const weekCards = weeks.length
    ? '<div class="week-grid">' + weeks.map(week => {
      const p = weekProgress(week);
      return '<article class="week-card">' +
        '<span class="badge">Week ' + week.number + '</span>' +
        '<h3><a class="week-card-link" href="' + routes.week(week.id) + '">' + esc(week.title) + '</a></h3>' +
        (week.date ? '<p class="muted">' + esc(formatDate(week.date)) + '</p>' : '') +
        (week.description ? '<p class="desc">' + esc(truncate(week.description, 110)) + '</p>' : '') +
        progressBar(p.percent, 'Week ' + week.number + ' progress') +
        '<div class="progress-label"><span>' + p.done + ' / ' + plural(p.total, 'topic') + ' done</span><span>' + p.percent + '%</span></div>' +
        '</article>';
    }).join('') + '</div>'
    : '<div class="empty-state"><p>No weeks yet. Start by adding Week 1.</p><button type="button" class="btn btn-primary" data-action="add-week">+ Add Week</button></div>';

  const upcomingHtml = upcoming.length
    ? '<ul class="item-list">' + upcoming.map(a => '<li class="item"><div class="item-main"><div class="item-title">' + esc(a.title) + '</div>' +
      '<div class="item-meta">' + dueText(a) + ' <span class="pill pill-' + a.status + '">' + ASSIGNMENT_STATUSES[a.status] + '</span></div></div></li>').join('') + '</ul>'
    : '<p class="muted">No open assignments. Nice work!</p>';

  return '<div class="page-header"><div>' +
      '<p class="eyebrow">Course dashboard</p>' +
      '<h1>' + esc(course.title) + '</h1>' +
      (course.semester ? '<p class="muted">' + esc(course.semester) + '</p>' : '') +
    '</div><div class="header-actions">' +
      '<button type="button" class="btn btn-primary" data-action="add-week">+ Add Week</button>' +
      '<button type="button" class="btn" data-action="add-assignment">+ Add Assignment</button>' +
    '</div></div>' +

    '<section class="stats-grid" aria-label="Course statistics">' +
      stat(weeks.length, 'Total weeks') +
      stat(totalTopics, 'Total topics') +
      stat(completed, 'Completed topics') +
      stat(percent + '%', 'Course progress') +
      stat(openAssignments.length, 'Open assignments', overdue > 0) +
    '</section>' +

    '<section class="card" aria-labelledby="overallHeading">' +
      '<h2 id="overallHeading">Overall progress</h2>' +
      progressBar(percent, 'Overall course progress') +
      '<div class="progress-label"><span>' + completed + ' of ' + plural(totalTopics, 'topic') + ' completed</span><span>' + percent + '%</span></div>' +
      (overdue ? '<p class="overdue-text">' + plural(overdue, 'assignment') + ' overdue.</p>' : '') +
    '</section>' +

    '<section aria-labelledby="modulesHeading" style="margin-bottom:20px">' +
      '<div class="section-head"><h2 id="modulesHeading">Weekly modules</h2>' +
      '<a class="btn btn-small" href="' + routes.weeks() + '">Manage weeks</a></div>' +
      weekCards +
    '</section>' +

    '<section class="card" aria-labelledby="upcomingHeading">' +
      '<div class="section-head"><h2 id="upcomingHeading">Upcoming assignments</h2>' +
      '<a class="btn btn-small" href="' + routes.assignments() + '">View all</a></div>' +
      upcomingHtml +
    '</section>';
}

function stat(value, label, warning = false) {
  return '<div class="stat' + (warning ? ' stat-warning' : '') + '"><span class="stat-value">' + esc(value) + '</span><span class="stat-label">' + esc(label) + '</span></div>';
}

function dueText(a) {
  if (!isValidDate(a.dueDate)) return '<span>No due date</span>';
  const days = daysUntil(a.dueDate);
  let relative = '';
  if (isAssignmentOpen(a)) {
    if (days < 0) relative = ' <span class="pill pill-overdue">Overdue by ' + plural(-days, 'day') + '</span>';
    else if (days === 0) relative = ' (due today)';
    else if (days === 1) relative = ' (due tomorrow)';
    else relative = ' (in ' + days + ' days)';
  }
  return '<span>Due ' + esc(formatDate(a.dueDate)) + relative + '</span>';
}

function viewWeeks() {
  const weeks = state.data.weeks;
  const list = weeks.length
    ? '<ul class="item-list">' + weeks.map(week => {
      const p = weekProgress(week);
      return '<li class="item"><span class="badge">Week ' + week.number + '</span>' +
        '<div class="item-main"><a class="item-title" href="' + routes.week(week.id) + '">' + esc(week.title) + '</a>' +
        '<div class="item-meta">' + (week.date ? '<span>' + esc(formatDate(week.date)) + '</span>' : '') +
        '<span>' + p.done + '/' + plural(p.total, 'topic') + ' completed</span></div></div>' +
        '<div class="item-actions">' +
        '<a class="btn btn-small" href="' + routes.week(week.id) + '">Open</a>' +
        '<button type="button" class="btn btn-small" data-action="edit-week" data-week-id="' + esc(week.id) + '">Edit</button>' +
        '<button type="button" class="btn btn-small btn-danger-outline" data-action="delete-week" data-week-id="' + esc(week.id) + '">Delete</button>' +
        '</div></li>';
    }).join('') + '</ul>'
    : '<div class="empty-state"><p>No weeks yet.</p><button type="button" class="btn btn-primary" data-action="add-week">+ Add Week</button></div>';

  return breadcrumb([{ label: 'Dashboard', href: routes.dashboard() }, { label: 'All weeks' }]) +
    '<div class="page-header"><div><p class="eyebrow">Course structure</p><h1>All weeks</h1>' +
    '<p class="muted">Weeks are sorted by week number. Open a week to manage its topics.</p></div>' +
    '<div class="header-actions"><button type="button" class="btn btn-primary" data-action="add-week">+ Add Week</button></div></div>' +
    list;
}

function viewWeek(weekId) {
  const week = findWeek(weekId);
  if (!week) return viewNotFound('This week does not exist. It may have been deleted.');
  const p = weekProgress(week);
  const related = state.data.assignments.filter(a => a.weekId === week.id);

  const topicsHtml = week.topics.length
    ? '<ol class="item-list">' + week.topics.map((topic, i) => {
      const done = topic.status === 'completed';
      const ids = 'data-week-id="' + esc(week.id) + '" data-topic-id="' + esc(topic.id) + '"';
      return '<li class="item' + (done ? ' is-completed' : '') + '">' +
        '<button type="button" class="check-btn" data-action="toggle-topic" ' + ids + ' aria-pressed="' + done + '" ' +
          'aria-label="' + esc((done ? 'Mark as pending: ' : 'Mark as completed: ') + topic.title) + '" title="' + (done ? 'Mark as pending' : 'Mark as completed') + '">' + (done ? '✓' : '') + '</button>' +
        '<span class="topic-number" aria-hidden="true">' + (i + 1) + '.</span>' +
        '<div class="item-main"><a class="item-title" href="' + routes.topic(week.id, topic.id) + '">' + esc(topic.title) + '</a>' +
        '<div class="item-meta"><span class="pill pill-' + topic.status + '">' + (done ? 'Completed' : 'Pending') + '</span>' +
        (Sanitizer.isEmpty(topic.content) ? '<span>No content yet</span>' : '') + '</div></div>' +
        '<div class="item-actions">' +
          '<a class="btn btn-small" href="' + routes.topic(week.id, topic.id) + '">Open</a>' +
          '<a class="btn btn-small" href="' + routes.edit(week.id, topic.id) + '">Edit content</a>' +
          '<button type="button" class="btn btn-small" data-action="rename-topic" ' + ids + '>Rename</button>' +
          '<button type="button" class="btn btn-small btn-icon" data-action="move-topic" data-direction="-1" ' + ids + (i === 0 ? ' disabled' : '') + ' aria-label="' + esc('Move up: ' + topic.title) + '" title="Move up">↑</button>' +
          '<button type="button" class="btn btn-small btn-icon" data-action="move-topic" data-direction="1" ' + ids + (i === week.topics.length - 1 ? ' disabled' : '') + ' aria-label="' + esc('Move down: ' + topic.title) + '" title="Move down">↓</button>' +
          '<button type="button" class="btn btn-small btn-danger-outline" data-action="delete-topic" ' + ids + '>Delete</button>' +
        '</div></li>';
    }).join('') + '</ol>'
    : '<div class="empty-state"><p>This week has no topics yet.</p><button type="button" class="btn btn-primary" data-action="add-topic" data-week-id="' + esc(week.id) + '">+ Add Topic</button></div>';

  const relatedHtml = related.length
    ? '<section class="card" aria-labelledby="weekAsgHeading"><h2 id="weekAsgHeading">Assignments for this week</h2><ul class="item-list">' +
      related.map(a => '<li class="item"><div class="item-main"><div class="item-title">' + esc(a.title) + '</div><div class="item-meta">' + dueText(a) +
        ' <span class="pill pill-' + a.status + '">' + ASSIGNMENT_STATUSES[a.status] + '</span></div></div>' +
        '<div class="item-actions"><button type="button" class="btn btn-small" data-action="edit-assignment" data-assignment-id="' + esc(a.id) + '">Edit</button></div></li>').join('') +
      '</ul></section>'
    : '';

  return breadcrumb([{ label: 'Dashboard', href: routes.dashboard() }, { label: 'Week ' + week.number }]) +
    '<div class="page-header"><div>' +
      '<p class="eyebrow">Week ' + week.number + (week.date ? ' · ' + esc(formatDate(week.date)) : '') + '</p>' +
      '<h1>' + esc(week.title) + '</h1>' +
      (week.description ? '<p class="pre-wrap">' + esc(week.description) + '</p>' : '<p class="muted">No description.</p>') +
    '</div><div class="header-actions">' +
      '<button type="button" class="btn" data-action="edit-week" data-week-id="' + esc(week.id) + '">Edit week</button>' +
      '<button type="button" class="btn btn-danger-outline" data-action="delete-week" data-week-id="' + esc(week.id) + '">Delete week</button>' +
    '</div></div>' +
    '<section class="card" aria-labelledby="weekProgressHeading"><h2 id="weekProgressHeading" class="visually-hidden">Week progress</h2>' +
      progressBar(p.percent, 'Week progress') +
      '<div class="progress-label"><span>' + p.done + ' of ' + plural(p.total, 'topic') + ' completed</span><span>' + p.percent + '%</span></div></section>' +
    '<section aria-labelledby="topicsHeading" style="margin-bottom:20px">' +
      '<div class="section-head"><h2 id="topicsHeading">Topics</h2>' +
      '<button type="button" class="btn btn-primary" data-action="add-topic" data-week-id="' + esc(week.id) + '">+ Add Topic</button></div>' +
      topicsHtml +
    '</section>' + relatedHtml;
}

/** All topics of all weeks in order - used for Previous / Next links. */
function allTopicsInOrder() {
  const list = [];
  state.data.weeks.forEach(week => week.topics.forEach(topic => list.push({ week, topic })));
  return list;
}

function viewTopic(weekId, topicId) {
  const found = findTopic(weekId, topicId);
  if (!found) return viewNotFound('This topic does not exist. It may have been deleted.');
  const { week, topic } = found;
  const done = topic.status === 'completed';
  const ids = 'data-week-id="' + esc(week.id) + '" data-topic-id="' + esc(topic.id) + '"';
  const safeContent = Sanitizer.sanitize(topic.content); // sanitised again before display (extra safety)

  const ordered = allTopicsInOrder();
  const pos = ordered.findIndex(item => item.topic.id === topic.id);
  const prev = ordered[pos - 1];
  const next = ordered[pos + 1];

  return breadcrumb([
    { label: 'Dashboard', href: routes.dashboard() },
    { label: 'Week ' + week.number, href: routes.week(week.id) },
    { label: topic.title }
  ]) +
    '<div class="page-header"><div>' +
      '<p class="eyebrow">' + esc(weekLabel(week)) + '</p>' +
      '<h1>' + esc(topic.title) + '</h1>' +
      '<p class="item-meta"><span class="pill pill-' + topic.status + '">' + (done ? 'Completed' : 'Pending') + '</span>' +
      (topic.updatedAt ? '<span>Last edited ' + esc(formatDateTime(topic.updatedAt)) + '</span>' : '') + '</p>' +
    '</div><div class="header-actions">' +
      '<button type="button" class="btn ' + (done ? '' : 'btn-outline') + '" data-action="toggle-topic" ' + ids + ' aria-pressed="' + done + '">' + (done ? 'Mark as pending' : '✓ Mark as completed') + '</button>' +
      '<a class="btn btn-primary" href="' + routes.edit(week.id, topic.id) + '">Edit content</a>' +
      '<button type="button" class="btn btn-danger-outline" data-action="delete-topic" ' + ids + '>Delete</button>' +
    '</div></div>' +
    '<article class="card lesson-card lesson-content" aria-label="Topic content">' +
      (Sanitizer.isEmpty(safeContent)
        ? '<div class="empty-state"><p>No content yet.</p><a class="btn btn-primary" href="' + routes.edit(week.id, topic.id) + '">Add content</a></div>'
        : safeContent) +
    '</article>' +
    '<nav class="topic-nav" aria-label="Topic navigation">' +
      (prev ? '<a class="btn" href="' + routes.topic(prev.week.id, prev.topic.id) + '">← ' + esc(prev.topic.title) + '</a>' : '<span></span>') +
      (next ? '<a class="btn" href="' + routes.topic(next.week.id, next.topic.id) + '">' + esc(next.topic.title) + ' →</a>' : '<span></span>') +
    '</nav>';
}

function viewAssignments() {
  const f = state.assignmentFilter;
  const options = '<option value="all">All statuses</option><option value="open">Open (not submitted)</option><option value="overdue">Overdue</option>' +
    Object.keys(ASSIGNMENT_STATUSES).map(key => '<option value="' + key + '">' + ASSIGNMENT_STATUSES[key] + '</option>').join('');
  return breadcrumb([{ label: 'Dashboard', href: routes.dashboard() }, { label: 'Assignments' }]) +
    '<div class="page-header"><div><p class="eyebrow">Coursework</p><h1>Assignments</h1>' +
    '<p class="muted">Homework, labs, quizzes and projects with due dates.</p></div>' +
    '<div class="header-actions"><button type="button" class="btn btn-primary" data-action="add-assignment">+ Add Assignment</button></div></div>' +
    '<div class="filter-bar">' +
      '<div><label for="assignmentSearch" class="visually-hidden">Search assignments</label>' +
      '<input id="assignmentSearch" type="search" placeholder="Search assignments by title or description..." value="' + esc(f.text) + '" maxlength="100"></div>' +
      '<div><label for="assignmentStatusFilter" class="visually-hidden">Filter by status</label>' +
      '<select id="assignmentStatusFilter">' + options.replace('value="' + f.status + '"', 'value="' + f.status + '" selected') + '</select></div>' +
    '</div>' +
    '<p id="assignmentCount" class="muted" aria-live="polite"></p>' +
    '<div id="assignmentList"></div>';
}

/** Redraws only the list, so typing in the search box keeps focus. */
function renderAssignmentList() {
  const container = $('#assignmentList');
  if (!container) return;
  const f = state.assignmentFilter;
  const words = f.text.toLowerCase().split(/\s+/).filter(Boolean);
  const all = state.data.assignments;
  const list = all.filter(a => {
    const haystack = (a.title + ' ' + a.description).toLowerCase();
    if (!words.every(w => haystack.includes(w))) return false;
    if (f.status === 'all') return true;
    if (f.status === 'open') return isAssignmentOpen(a);
    if (f.status === 'overdue') return isAssignmentOverdue(a);
    return a.status === f.status;
  }).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

  $('#assignmentCount').textContent = 'Showing ' + list.length + ' of ' + plural(all.length, 'assignment') + '.';

  if (!all.length) {
    container.innerHTML = '<div class="empty-state"><p>No assignments yet.</p><button type="button" class="btn btn-primary" data-action="add-assignment">+ Add Assignment</button></div>';
    return;
  }
  if (!list.length) {
    container.innerHTML = '<div class="empty-state"><p>No assignments match your search or filter.</p><button type="button" class="btn" data-action="clear-assignment-filter">Clear search and filter</button></div>';
    return;
  }
  container.innerHTML = '<ul class="item-list">' + list.map(a => {
    const week = a.weekId ? findWeek(a.weekId) : null;
    const statusOptions = Object.keys(ASSIGNMENT_STATUSES).map(key =>
      '<option value="' + key + '"' + (key === a.status ? ' selected' : '') + '>' + ASSIGNMENT_STATUSES[key] + '</option>').join('');
    return '<li class="item' + (a.status === 'submitted' || a.status === 'graded' ? ' is-completed' : '') + '">' +
      '<div class="item-main"><div class="item-title">' + highlight(a.title, words) + '</div>' +
      '<div class="item-meta">' + dueText(a) +
      (week ? '<a href="' + routes.week(week.id) + '">' + esc('Week ' + week.number + ': ' + week.title) + '</a>' : '') + '</div>' +
      (a.description ? '<p class="item-desc pre-wrap">' + highlight(a.description, words) + '</p>' : '') + '</div>' +
      '<div class="item-actions">' +
        '<label class="visually-hidden" for="status-' + esc(a.id) + '">Status of ' + esc(a.title) + '</label>' +
        '<select id="status-' + esc(a.id) + '" class="assignment-status-select" data-change="assignment-status" data-assignment-id="' + esc(a.id) + '">' + statusOptions + '</select>' +
        '<button type="button" class="btn btn-small" data-action="edit-assignment" data-assignment-id="' + esc(a.id) + '">Edit</button>' +
        '<button type="button" class="btn btn-small btn-danger-outline" data-action="delete-assignment" data-assignment-id="' + esc(a.id) + '">Delete</button>' +
      '</div></li>';
  }).join('') + '</ul>';
}

/** Escapes text and wraps search words in <mark>. */
function highlight(text, words) {
  if (!words.length) return esc(text);
  const pattern = new RegExp('(' + words.map(escapeRegExp).join('|') + ')', 'gi');
  return String(text).split(pattern).map((part, i) => i % 2 === 1 ? '<mark>' + esc(part) + '</mark>' : esc(part)).join('');
}

/** A short piece of text around the first search word. */
function snippet(text, words, size = 160) {
  const lower = text.toLowerCase();
  let index = -1;
  words.forEach(w => {
    const i = lower.indexOf(w);
    if (i !== -1 && (index === -1 || i < index)) index = i;
  });
  if (index === -1) return truncate(text, size);
  const start = Math.max(0, index - 50);
  const piece = text.slice(start, start + size);
  return (start > 0 ? '…' : '') + piece + (start + size < text.length ? '…' : '');
}

function viewSearch(query) {
  const q = (query || '').trim();
  const header = breadcrumb([{ label: 'Dashboard', href: routes.dashboard() }, { label: 'Search' }]);
  if (!q) {
    return header + '<div class="page-header"><div><h1>Search</h1><p class="muted">Type a word in the search box at the top (for example "scheduling" or "fork") and press Enter.</p></div></div>';
  }
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = text => { const lower = text.toLowerCase(); return words.every(w => lower.includes(w)); };

  const weekResults = state.data.weeks.filter(w => matches('week ' + w.number + ' ' + w.title + ' ' + w.description));
  const topicResults = [];
  state.data.weeks.forEach(week => week.topics.forEach(topic => {
    const body = Sanitizer.toText(topic.content);
    if (matches(topic.title + ' ' + body)) topicResults.push({ week, topic, body });
  }));
  const asgResults = state.data.assignments.filter(a => matches(a.title + ' ' + a.description));
  const total = weekResults.length + topicResults.length + asgResults.length;

  const group = (title, items) => '<section class="card search-group"><h2>' + title + ' (' + items.length + ')</h2>' +
    (items.length ? '<ul class="item-list">' + items.join('') + '</ul>' : '<p class="muted">No matches.</p>') + '</section>';

  return header +
    '<div class="page-header"><div><p class="eyebrow">Search results</p><h1>Results for “' + esc(q) + '”</h1>' +
    '<p class="muted">' + plural(total, 'result') + ' found.</p></div>' +
    '<div class="header-actions"><button type="button" class="btn" data-action="clear-search">Clear search</button></div></div>' +
    group('Weeks', weekResults.map(w => '<li class="item"><span class="badge">Week ' + w.number + '</span><div class="item-main">' +
      '<a class="item-title" href="' + routes.week(w.id) + '">' + highlight(w.title, words) + '</a>' +
      (w.description ? '<p class="search-snippet">' + highlight(snippet(w.description, words), words) + '</p>' : '') + '</div></li>')) +
    group('Topics', topicResults.map(r => '<li class="item"><div class="item-main">' +
      '<a class="item-title" href="' + routes.topic(r.week.id, r.topic.id) + '">' + highlight(r.topic.title, words) + '</a>' +
      '<div class="item-meta"><span>' + esc(weekLabel(r.week)) + '</span><span class="pill pill-' + r.topic.status + '">' + (r.topic.status === 'completed' ? 'Completed' : 'Pending') + '</span></div>' +
      (r.body ? '<p class="search-snippet">' + highlight(snippet(r.body, words), words) + '</p>' : '') + '</div></li>')) +
    group('Assignments', asgResults.map(a => '<li class="item"><div class="item-main">' +
      '<a class="item-title" href="' + routes.assignments() + '">' + highlight(a.title, words) + '</a>' +
      '<div class="item-meta">' + dueText(a) + '<span class="pill pill-' + a.status + '">' + ASSIGNMENT_STATUSES[a.status] + '</span></div>' +
      (a.description ? '<p class="search-snippet">' + highlight(snippet(a.description, words), words) + '</p>' : '') + '</div></li>'));
}

function viewData() {
  const data = state.data;
  const json = JSON.stringify(data);
  const sizeMb = (json.length / (1024 * 1024)).toFixed(2);
  const lastExport = data.meta.lastExportAt ? formatDateTime(data.meta.lastExportAt) : 'never';
  const totalTopics = data.weeks.reduce((s, w) => s + w.topics.length, 0);

  return breadcrumb([{ label: 'Dashboard', href: routes.dashboard() }, { label: 'Backup & Data' }]) +
    '<div class="page-header"><div><p class="eyebrow">Settings</p><h1>Backup &amp; Data</h1>' +
    '<p class="muted">Course settings, backups and resetting the course.</p></div></div>' +

    '<div class="notice notice-warning">' +
      '<p><strong>Where is my data stored?</strong> Only inside this browser on this computer (in "localStorage"). It is <strong>not</strong> uploaded anywhere and does <strong>not</strong> sync to other devices or browsers.</p>' +
      '<p>Your data can be lost if you clear browsing data / site data / cookies, use a private (incognito) window, or uninstall the browser. Opening the app in a different browser, or from a different address (for example by double-clicking the file vs. using VS Code Live Server), shows a separate, empty copy.</p>' +
      '<p><strong>Export a backup regularly</strong> (for example once a week) and keep the file somewhere safe such as Google Drive or a USB drive.</p>' +
    '</div>' +

    '<div class="data-grid">' +
      '<section class="card" aria-labelledby="courseSettingsHeading">' +
        '<h2 id="courseSettingsHeading">Course settings</h2>' +
        '<form id="courseForm" novalidate>' +
          '<div class="field"><label for="courseTitle">Course title <span class="req" aria-hidden="true">*</span></label>' +
          '<input id="courseTitle" name="title" type="text" maxlength="' + LIMITS.courseTitle + '" value="' + esc(data.course.title) + '" required>' +
          '<p class="field-error" data-error-for="title"></p></div>' +
          '<div class="field"><label for="courseSemester">Semester / subtitle</label>' +
          '<input id="courseSemester" name="semester" type="text" maxlength="' + LIMITS.semester + '" value="' + esc(data.course.semester) + '" placeholder="e.g. Fall 2026 - Section A">' +
          '<p class="field-error" data-error-for="semester"></p></div>' +
          '<button type="submit" class="btn btn-primary">Save course settings</button>' +
        '</form>' +
      '</section>' +

      '<section class="card" aria-labelledby="backupHeading">' +
        '<h2 id="backupHeading">Backup</h2>' +
        '<p>Current data: ' + plural(data.weeks.length, 'week') + ', ' + plural(totalTopics, 'topic') + ', ' + plural(data.assignments.length, 'assignment') + '.</p>' +
        '<p class="muted">Approximate size: ' + sizeMb + ' MB (browsers usually allow about 5 MB). Last export: ' + esc(lastExport) + '.</p>' +
        '<div class="button-row">' +
          '<button type="button" class="btn btn-primary" data-action="export">⬇ Export backup (JSON)</button>' +
          '<button type="button" class="btn" data-action="import">⬆ Import backup...</button>' +
        '</div>' +
        '<p class="hint">Importing checks the file first. Your current data is replaced only after you confirm.</p>' +
        '<div id="importErrors"></div>' +
      '</section>' +

      '<section class="card" aria-labelledby="resetHeading">' +
        '<h2 id="resetHeading">Start over</h2>' +
        '<p>Both options replace <strong>all</strong> current weeks, topics and assignments. Export a backup first if you want to keep them.</p>' +
        '<div class="button-row">' +
          '<button type="button" class="btn btn-danger-outline" data-action="load-sample">Restore sample data</button>' +
          '<button type="button" class="btn btn-danger-outline" data-action="start-empty">Start with an empty course</button>' +
        '</div>' +
      '</section>' +
    '</div>';
}

function viewNotFound(message = 'The page you are looking for does not exist.') {
  return '<div class="page-header"><div><h1>Not found</h1><p>' + esc(message) + '</p>' +
    '<a class="btn btn-primary" href="' + routes.dashboard() + '">Go to the dashboard</a></div></div>';
}

/** Sidebar: highlights the current page and lists all weeks. */
function renderSidebar(route = state.route) {
  $('#brandCourseTitle').textContent = state.data.course.title;

  const navKey = { dashboard: 'dashboard', weeks: 'weeks', assignments: 'assignments', data: 'data' }[route.name];
  document.querySelectorAll('[data-nav]').forEach(link => {
    if (link.dataset.nav === navKey) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  const openCount = state.data.assignments.filter(isAssignmentOpen).length;
  const badge = $('#navAssignmentCount');
  badge.textContent = openCount;
  badge.hidden = openCount === 0;
  badge.setAttribute('aria-label', openCount + ' open');

  const activeWeekId = ['week', 'topic', 'edit'].includes(route.name) ? route.weekId : null;
  const list = $('#sidebarWeeks');
  list.innerHTML = state.data.weeks.length
    ? state.data.weeks.map(week => {
      const p = weekProgress(week);
      return '<li><a href="' + routes.week(week.id) + '"' + (week.id === activeWeekId ? ' aria-current="page"' : '') + '>' +
        '<span class="sidebar-week-num">W' + week.number + '</span>' +
        '<span class="sidebar-week-title">' + esc(week.title) + '</span>' +
        '<span class="sidebar-week-count">' + p.done + '/' + p.total + '</span></a></li>';
    }).join('')
    : '<li class="sidebar-empty">No weeks yet.</li>';
}

function openSidebar() {
  $('#sidebar').classList.add('is-open');
  $('#sidebarOverlay').hidden = false;
  $('#menuToggle').setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  $('#sidebar').classList.remove('is-open');
  $('#sidebarOverlay').hidden = true;
  $('#menuToggle').setAttribute('aria-expanded', 'false');
}

/* =========================================================
   8. DIALOG FORMS: week, topic, assignment
   ========================================================= */

function openWeekDialog(weekId) {
  const form = $('#weekForm');
  form.reset();
  showFormErrors(form, {});
  const week = weekId ? findWeek(weekId) : null;
  if (weekId && !week) { toast('That week no longer exists.', 'error'); return; }
  $('#weekDialogTitle').textContent = week ? 'Edit week' : 'Add week';
  form.elements.id.value = week ? week.id : '';
  const nextNumber = state.data.weeks.reduce((max, w) => Math.max(max, w.number), 0) + 1;
  form.elements.number.value = week ? week.number : Math.min(nextNumber, LIMITS.maxWeekNumber);
  form.elements.title.value = week ? week.title : '';
  form.elements.date.value = week ? week.date : '';
  form.elements.description.value = week ? week.description : '';
  openDialog($('#weekDialog'));
  form.elements.title.focus();
}

function handleWeekSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const id = form.elements.id.value;
  const numberRaw = form.elements.number.value.trim();
  const number = Number(numberRaw);
  const title = form.elements.title.value.trim();
  const date = form.elements.date.value;
  const description = form.elements.description.value.trim();

  const errors = {};
  if (!numberRaw) errors.number = 'Enter a week number.';
  else if (!Number.isInteger(number) || number < 1 || number > LIMITS.maxWeekNumber) errors.number = 'Use a whole number from 1 to ' + LIMITS.maxWeekNumber + '.';
  else if (state.data.weeks.some(w => w.number === number && w.id !== id)) errors.number = 'Week ' + number + ' already exists. Choose another number.';
  if (!title) errors.title = 'Enter a title for this week.';
  else if (title.length > LIMITS.title) errors.title = 'The title is too long (maximum ' + LIMITS.title + ' characters).';
  if (date && !isValidDate(date)) errors.date = 'Enter a valid date.';
  if (description.length > LIMITS.description) errors.description = 'The description is too long.';
  if (showFormErrors(form, errors)) return;

  let newId = '';
  const ok = updateData(data => {
    if (id) {
      const week = findWeek(id);
      if (!week) throw new Error('That week no longer exists.');
      Object.assign(week, { number, title, date, description });
    } else {
      newId = createId('week');
      data.weeks.push({ id: newId, number, title, date, description, topics: [] });
    }
    sortWeeks(data);
  }, id ? 'Week updated.' : 'Week ' + number + ' added.');
  if (!ok) return;
  closeDialog($('#weekDialog'));
  if (newId) navigate(routes.week(newId));
  else refresh();
}

function openTopicDialog(weekId, topicId) {
  const week = findWeek(weekId);
  if (!week) { toast('That week no longer exists.', 'error'); return; }
  const found = topicId ? findTopic(weekId, topicId) : null;
  if (topicId && !found) { toast('That topic no longer exists.', 'error'); return; }
  const form = $('#topicForm');
  form.reset();
  showFormErrors(form, {});
  $('#topicDialogTitle').textContent = found ? 'Rename topic' : 'Add topic to Week ' + week.number;
  form.elements.weekId.value = weekId;
  form.elements.topicId.value = found ? found.topic.id : '';
  form.elements.title.value = found ? found.topic.title : '';
  $('#topicOpenEditorField').hidden = Boolean(found);
  openDialog($('#topicDialog'));
  form.elements.title.focus();
}

function handleTopicSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const weekId = form.elements.weekId.value;
  const topicId = form.elements.topicId.value;
  const title = form.elements.title.value.trim();
  const openEditor = form.elements.openEditor.checked;

  const errors = {};
  if (!title) errors.title = 'Enter a topic title.';
  else if (title.length > LIMITS.title) errors.title = 'The title is too long (maximum ' + LIMITS.title + ' characters).';
  if (showFormErrors(form, errors)) return;

  let newId = '';
  const ok = updateData(() => {
    const week = findWeek(weekId);
    if (!week) throw new Error('That week no longer exists.');
    if (topicId) {
      const found = findTopic(weekId, topicId);
      if (!found) throw new Error('That topic no longer exists.');
      found.topic.title = title;
      found.topic.updatedAt = new Date().toISOString();
    } else {
      newId = createId('topic');
      week.topics.push({ id: newId, title, status: 'pending', content: '', updatedAt: new Date().toISOString() });
    }
  }, topicId ? 'Topic renamed.' : 'Topic added.');
  if (!ok) return;
  closeDialog($('#topicDialog'));
  if (newId && openEditor) navigate(routes.edit(weekId, newId));
  else refresh();
}

function openAssignmentDialog(assignmentId) {
  const a = assignmentId ? findAssignment(assignmentId) : null;
  if (assignmentId && !a) { toast('That assignment no longer exists.', 'error'); return; }
  const form = $('#assignmentForm');
  form.reset();
  showFormErrors(form, {});
  $('#assignmentDialogTitle').textContent = a ? 'Edit assignment' : 'Add assignment';
  const weekSelect = form.elements.weekId;
  weekSelect.innerHTML = '<option value="">No specific week</option>' +
    state.data.weeks.map(w => '<option value="' + esc(w.id) + '">' + esc(truncate(weekLabel(w), 70)) + '</option>').join('');
  form.elements.id.value = a ? a.id : '';
  form.elements.title.value = a ? a.title : '';
  form.elements.description.value = a ? a.description : '';
  form.elements.dueDate.value = a ? a.dueDate : '';
  form.elements.status.value = a ? a.status : 'not-started';
  // When adding from a week page, pre-select that week.
  const routeWeek = ['week', 'topic', 'edit'].includes(state.route.name) ? state.route.weekId : '';
  weekSelect.value = a ? a.weekId : (findWeek(routeWeek) ? routeWeek : '');
  openDialog($('#assignmentDialog'));
  form.elements.title.focus();
}

function handleAssignmentSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const id = form.elements.id.value;
  const title = form.elements.title.value.trim();
  const description = form.elements.description.value.trim();
  const dueDate = form.elements.dueDate.value;
  const status = form.elements.status.value;
  const weekId = form.elements.weekId.value;

  const errors = {};
  if (!title) errors.title = 'Enter an assignment title.';
  else if (title.length > LIMITS.title) errors.title = 'The title is too long (maximum ' + LIMITS.title + ' characters).';
  if (description.length > LIMITS.description) errors.description = 'The description is too long.';
  if (dueDate && !isValidDate(dueDate)) errors.dueDate = 'Enter a valid date.';
  if (!Object.prototype.hasOwnProperty.call(ASSIGNMENT_STATUSES, status)) errors.status = 'Choose a status.';
  if (showFormErrors(form, errors)) return;

  const ok = updateData(data => {
    const values = { title, description, dueDate, status, weekId: findWeek(weekId) ? weekId : '' };
    if (id) {
      const a = findAssignment(id);
      if (!a) throw new Error('That assignment no longer exists.');
      Object.assign(a, values);
    } else {
      data.assignments.push(Object.assign({ id: createId('asg') }, values));
    }
  }, id ? 'Assignment updated.' : 'Assignment added.');
  if (!ok) return;
  closeDialog($('#assignmentDialog'));
  refresh();
}

function handleCourseSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const title = form.elements.title.value.trim();
  const semester = form.elements.semester.value.trim();
  const errors = {};
  if (!title) errors.title = 'Enter a course title.';
  else if (title.length > LIMITS.courseTitle) errors.title = 'The title is too long.';
  if (semester.length > LIMITS.semester) errors.semester = 'This text is too long.';
  if (showFormErrors(form, errors)) return;
  if (updateData(data => { data.course.title = title; data.course.semester = semester; }, 'Course settings saved.')) refresh();
}

/* =========================================================
   9. BUTTON ACTIONS
   Every button with data-action="name" runs actions[name].
   ========================================================= */

const actions = {
  'add-week': () => openWeekDialog(),
  'edit-week': d => openWeekDialog(d.weekId),

  'delete-week': async d => {
    const week = findWeek(d.weekId);
    if (!week) return;
    const linked = state.data.assignments.filter(a => a.weekId === week.id).length;
    const ok = await confirmAction({
      title: 'Delete week?',
      message: 'Delete "' + weekLabel(week) + '" and its ' + plural(week.topics.length, 'topic') + '?\n\nThis cannot be undone.' +
        (linked ? '\n' + plural(linked, 'linked assignment') + ' will be kept but no longer linked to a week.' : ''),
      confirmText: 'Delete week'
    });
    if (!ok) return;
    const done = updateData(data => {
      data.weeks = data.weeks.filter(w => w.id !== week.id);
      data.assignments.forEach(a => { if (a.weekId === week.id) a.weekId = ''; });
    }, 'Week deleted.');
    if (!done) return;
    if (['week', 'topic', 'edit'].includes(state.route.name) && state.route.weekId === week.id) {
      state.editorDirty = false;
      navigate(routes.dashboard());
    } else {
      refresh();
    }
  },

  'add-topic': d => openTopicDialog(d.weekId),
  'rename-topic': d => openTopicDialog(d.weekId, d.topicId),

  'toggle-topic': d => {
    const found = findTopic(d.weekId, d.topicId);
    if (!found) return;
    const next = found.topic.status === 'completed' ? 'pending' : 'completed';
    const ok = updateData(() => { found.topic.status = next; },
      next === 'completed' ? 'Marked "' + truncate(found.topic.title, 40) + '" as completed.' : 'Marked "' + truncate(found.topic.title, 40) + '" as pending.');
    if (ok) refresh();
  },

  'move-topic': d => {
    const found = findTopic(d.weekId, d.topicId);
    if (!found) return;
    const to = found.index + Number(d.direction);
    if (to < 0 || to >= found.week.topics.length) return;
    const ok = updateData(() => {
      const topics = found.week.topics;
      [topics[found.index], topics[to]] = [topics[to], topics[found.index]];
    }, 'Topic moved ' + (Number(d.direction) < 0 ? 'up.' : 'down.'));
    if (ok) {
      refresh();
      // Keep keyboard focus on the same move button after redrawing.
      const sameButton = document.querySelector('[data-action="move-topic"][data-topic-id="' + CSS.escape(d.topicId) + '"][data-direction="' + d.direction + '"]');
      if (sameButton && !sameButton.disabled) sameButton.focus();
    }
  },

  'delete-topic': async d => {
    const found = findTopic(d.weekId, d.topicId);
    if (!found) return;
    const ok = await confirmAction({
      title: 'Delete topic?',
      message: 'Delete "' + found.topic.title + '" and all of its content?\n\nThis cannot be undone.',
      confirmText: 'Delete topic'
    });
    if (!ok) return;
    const done = updateData(() => {
      found.week.topics = found.week.topics.filter(t => t.id !== found.topic.id);
    }, 'Topic deleted.');
    if (!done) return;
    if (['topic', 'edit'].includes(state.route.name) && state.route.topicId === found.topic.id) {
      state.editorDirty = false;
      navigate(routes.week(found.week.id));
    } else {
      refresh();
    }
  },

  'add-assignment': () => openAssignmentDialog(),
  'edit-assignment': d => openAssignmentDialog(d.assignmentId),

  'delete-assignment': async d => {
    const a = findAssignment(d.assignmentId);
    if (!a) return;
    const ok = await confirmAction({
      title: 'Delete assignment?',
      message: 'Delete "' + a.title + '"?\n\nThis cannot be undone.',
      confirmText: 'Delete assignment'
    });
    if (!ok) return;
    if (updateData(data => { data.assignments = data.assignments.filter(x => x.id !== a.id); }, 'Assignment deleted.')) refresh();
  },

  'clear-assignment-filter': () => {
    state.assignmentFilter = { text: '', status: 'all' };
    refresh();
  },

  'clear-search': () => {
    $('#searchInput').value = '';
    navigate(routes.dashboard());
  },

  'editor-save': () => saveEditor(false),
  'editor-save-view': () => saveEditor(true),
  'editor-cancel': () => cancelEditor(),

  'export': () => exportBackup(),
  'import': () => $('#importFile').click(),
  'load-sample': () => resetCourse('sample'),
  'start-empty': () => resetCourse('empty')
};

/* =========================================================
   10. LESSON CONTENT EDITOR
   A "contenteditable" area with a toolbar. It works offline and
   needs no library. Formatting uses the browser's built-in
   document.execCommand, which all major browsers still support.
   Content is always passed through the Sanitizer when saved.
   ========================================================= */

const editor = {
  savedRange: null,  // where the cursor was before a toolbar/dialog took focus
  editingPre: null   // the code block being edited by the code dialog
};

const CALLOUT_TYPES = {
  important: 'Write the important point here.',
  example: 'Write the example here.',
  note: 'Write the note here.',
  problem: 'Write the problem / question here.',
  homework: 'Write the homework or assignment task here.'
};

function viewEditor(weekId, topicId) {
  const found = findTopic(weekId, topicId);
  if (!found) return viewNotFound('This topic does not exist. It may have been deleted.');
  const { week, topic } = found;
  const btn = (cmd, label, title, html) =>
    '<button type="button" class="tb-btn" data-cmd="' + cmd + '" title="' + title + '" aria-label="' + title + '">' + (html || label) + '</button>';

  return breadcrumb([
    { label: 'Dashboard', href: routes.dashboard() },
    { label: 'Week ' + week.number, href: routes.week(week.id) },
    { label: topic.title, href: routes.topic(week.id, topic.id) },
    { label: 'Edit' }
  ]) +
    '<div class="page-header"><div><p class="eyebrow">' + esc(weekLabel(week)) + ' · Editing</p>' +
    '<h1 id="editorHeading">Edit: ' + esc(topic.title) + '</h1></div></div>' +
    '<form id="editorForm" novalidate>' +
      '<div class="editor-meta">' +
        '<div class="field"><label for="editorTitle">Topic title <span class="req" aria-hidden="true">*</span></label>' +
        '<input id="editorTitle" name="title" type="text" maxlength="' + LIMITS.title + '" value="' + esc(topic.title) + '" required>' +
        '<p class="field-error" data-error-for="title"></p></div>' +
        '<div class="field"><label for="editorStatus">Status</label><select id="editorStatus" name="status">' +
          '<option value="pending"' + (topic.status === 'pending' ? ' selected' : '') + '>Pending</option>' +
          '<option value="completed"' + (topic.status === 'completed' ? ' selected' : '') + '>Completed</option>' +
        '</select></div>' +
      '</div>' +
      '<div class="editor-shell">' +
        '<div class="editor-toolbar" role="toolbar" aria-label="Text formatting" id="editorToolbar">' +
          '<div class="tb-group">' +
            '<label for="tbBlock" class="visually-hidden">Text style</label>' +
            '<select id="tbBlock" class="tb-select" data-cmd-select="block">' +
              '<option value="">Text style…</option><option value="p">Paragraph</option>' +
              '<option value="h2">Heading 1 (large)</option><option value="h3">Heading 2 (medium)</option><option value="h4">Heading 3 (small)</option>' +
            '</select>' +
          '</div>' +
          '<div class="tb-group">' +
            btn('bold', '', 'Bold (Ctrl+B)', '<b>B</b>') +
            btn('italic', '', 'Italic (Ctrl+I)', '<i>I</i>') +
            btn('underline', '', 'Underline (Ctrl+U)', '<u>U</u>') +
            btn('strikeThrough', '', 'Strikethrough', '<s>S</s>') +
            btn('highlight', '', 'Highlight text', '<mark>H</mark>') +
            btn('inlineCode', '&lt;/&gt;', 'Inline code') +
          '</div>' +
          '<div class="tb-group">' +
            btn('ul', '• List', 'Bulleted list') +
            btn('ol', '1. List', 'Numbered list') +
            btn('outdent', '⇤', 'Decrease indent') +
            btn('indent', '⇥', 'Increase indent') +
            btn('quote', '“ ”', 'Quote') +
            btn('hr', '―', 'Horizontal line') +
          '</div>' +
          '<div class="tb-group">' +
            btn('table', '▦ Table', 'Insert table') +
            btn('rowAdd', '+Row', 'Add table row below') +
            btn('colAdd', '+Col', 'Add table column to the right') +
            btn('rowDelete', '−Row', 'Delete table row') +
            btn('colDelete', '−Col', 'Delete table column') +
            btn('tableDelete', '✕Table', 'Delete whole table') +
          '</div>' +
          '<div class="tb-group">' +
            btn('code', '{ } Code', 'Insert or edit code block') +
            btn('image', '🖼 Image', 'Insert image or diagram') +
            btn('link', '🔗 Link', 'Insert link') +
            btn('unlink', 'Unlink', 'Remove link') +
          '</div>' +
          '<div class="tb-group">' +
            '<label for="tbCallout" class="visually-hidden">Insert box</label>' +
            '<select id="tbCallout" class="tb-select" data-cmd-select="callout">' +
              '<option value="">Insert box…</option><option value="important">Important point</option>' +
              '<option value="example">Example</option><option value="note">Note</option>' +
              '<option value="problem">Problem</option><option value="homework">Homework / Assignment</option>' +
            '</select>' +
          '</div>' +
          '<div class="tb-group">' +
            btn('undo', '↶', 'Undo (Ctrl+Z)') +
            btn('redo', '↷', 'Redo (Ctrl+Y)') +
            btn('clear', 'Clear format', 'Remove formatting from selected text') +
          '</div>' +
        '</div>' +
        '<div id="editorArea" class="editor-area lesson-content" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Topic content" spellcheck="true"></div>' +
      '</div>' +
      '<ul class="editor-tips">' +
        '<li>Select text, then click a toolbar button to format it. Tables: click inside a table first, then use +Row / +Col.</li>' +
        '<li>To edit a code block, click inside it and press "{ } Code". To continue writing below a block, click the empty line under it.</li>' +
        '<li>You can paste text from websites or Word - unsafe parts are removed automatically. Screenshots can be pasted with Ctrl+V.</li>' +
        '<li>Press Ctrl+S to save.</li>' +
      '</ul>' +
      '<div class="editor-actions">' +
        '<span id="editorSaveState" class="editor-save-state" aria-live="polite">No unsaved changes</span>' +
        '<button type="button" class="btn" data-action="editor-cancel">Cancel</button>' +
        '<button type="button" class="btn btn-outline" data-action="editor-save">Save</button>' +
        '<button type="button" class="btn btn-primary" data-action="editor-save-view">Save &amp; view</button>' +
      '</div>' +
    '</form>';
}

function getEditorArea() {
  return document.getElementById('editorArea');
}

/** Runs after the editor page is drawn: loads content and connects events. */
function setupEditor(weekId, topicId) {
  const area = getEditorArea();
  if (!area) return;
  const found = findTopic(weekId, topicId);
  area.innerHTML = Sanitizer.sanitize(found.topic.content);
  state.editorDirty = false;
  editor.savedRange = null;
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (err) { /* older browsers */ }

  const form = $('#editorForm');
  form.addEventListener('submit', e => { e.preventDefault(); saveEditor(false); });
  form.addEventListener('input', markEditorDirty);
  form.addEventListener('change', e => { if (!e.target.matches('[data-cmd-select]')) markEditorDirty(); });

  const toolbar = $('#editorToolbar');
  // Keep the text selection when clicking toolbar buttons.
  toolbar.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  toolbar.addEventListener('click', e => {
    const button = e.target.closest('[data-cmd]');
    if (button) runEditorCommand(button.dataset.cmd);
  });
  toolbar.addEventListener('change', e => {
    const select = e.target.closest('[data-cmd-select]');
    if (!select || !select.value) return;
    const value = select.value;
    select.value = '';
    if (select.dataset.cmdSelect === 'block') {
      execFormat('formatBlock', '<' + value + '>');
    } else {
      insertCallout(value);
    }
  });

  area.addEventListener('keydown', handleEditorKeydown);
  area.addEventListener('paste', handleEditorPaste);
  area.addEventListener('drop', handleEditorDrop);
}

function markEditorDirty() {
  if (!getEditorArea()) return;
  state.editorDirty = true;
  const label = $('#editorSaveState');
  if (label) {
    label.textContent = 'Unsaved changes';
    label.classList.add('is-dirty');
  }
}

/** Remembers the cursor position inside the editor (called on every selection change). */
function rememberSelection() {
  const area = getEditorArea();
  const selection = window.getSelection();
  if (!area || !selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (area.contains(range.commonAncestorContainer)) editor.savedRange = range.cloneRange();
}

/** Puts the cursor back where it was, or at the end of the editor. */
function restoreSelection() {
  const area = getEditorArea();
  if (!area) return null;
  area.focus({ preventScroll: true });
  const selection = window.getSelection();
  let range = editor.savedRange;
  if (!range || !area.contains(range.commonAncestorContainer)) {
    range = document.createRange();
    range.selectNodeContents(area);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

function execFormat(command, value = null) {
  restoreSelection();
  document.execCommand(command, false, value);
  markEditorDirty();
  rememberSelection();
}

function runEditorCommand(cmd) {
  switch (cmd) {
    case 'bold':
    case 'italic':
    case 'underline':
    case 'strikeThrough':
    case 'indent':
    case 'outdent':
    case 'undo':
    case 'redo':
    case 'unlink':
      execFormat(cmd); break;
    case 'ul': execFormat('insertUnorderedList'); break;
    case 'ol': execFormat('insertOrderedList'); break;
    case 'quote': execFormat('formatBlock', '<blockquote>'); break;
    case 'clear': execFormat('removeFormat'); break;
    case 'highlight': wrapSelection('mark', 'highlighted text'); break;
    case 'inlineCode': wrapSelection('code', 'code'); break;
    case 'hr': insertBlockElement(document.createElement('hr')); break;
    case 'table': openEditorDialog('#tableDialog', '#tableRows'); break;
    case 'rowAdd': tableCommand('rowAdd'); break;
    case 'colAdd': tableCommand('colAdd'); break;
    case 'rowDelete': tableCommand('rowDelete'); break;
    case 'colDelete': tableCommand('colDelete'); break;
    case 'tableDelete': tableCommand('tableDelete'); break;
    case 'code': openCodeDialog(); break;
    case 'image': openEditorDialog('#imageDialog', '#imageFile'); break;
    case 'link': openLinkDialog(); break;
    default: toast('Unknown editor command: ' + cmd, 'error');
  }
}

/** Wraps selected text in <code> or <mark> (or inserts a placeholder). */
function wrapSelection(tag, placeholder) {
  const range = restoreSelection();
  const text = range.toString() || placeholder;
  const el = document.createElement(tag);
  el.textContent = text;
  range.deleteContents();
  range.insertNode(el);
  const after = document.createTextNode('​'); // lets you keep typing outside the tag
  el.after(after);
  placeCaretAfter(after);
  markEditorDirty();
}

function placeCaretAfter(node) {
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  editor.savedRange = range.cloneRange();
}

function placeCaretInside(node, selectAll = false) {
  const range = document.createRange();
  range.selectNodeContents(node);
  if (!selectAll) range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  editor.savedRange = range.cloneRange();
}

/** Finds the direct child of the editor that contains the node. */
function topLevelBlock(node) {
  const area = getEditorArea();
  if (!node || node === area) return null;
  while (node.parentNode && node.parentNode !== area) node = node.parentNode;
  return node.parentNode === area ? node : null;
}

function isEmptyBlock(node) {
  if (!node) return false;
  if (node.nodeType === Node.TEXT_NODE) return node.data.replace(/​/g, '').trim() === '';
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  return /^(P|DIV|H2|H3|H4)$/.test(node.tagName) && !node.classList.contains('callout') &&
    node.textContent.replace(/​/g, '').trim() === '' && !node.querySelector('img,table,pre,hr');
}

/**
 * Inserts a block (table, code, image, box, line) after the paragraph
 * where the cursor is, and adds an empty paragraph after it so you can
 * keep typing.
 */
function insertBlockElement(element, caretTarget) {
  const area = getEditorArea();
  const range = restoreSelection();
  let anchor = null;
  if (range.startContainer === area) {
    anchor = area.childNodes[range.startOffset - 1] || area.childNodes[range.startOffset] || null;
  } else {
    anchor = topLevelBlock(range.startContainer);
  }
  if (anchor && isEmptyBlock(anchor)) area.replaceChild(element, anchor);
  else if (anchor) anchor.after(element);
  else area.appendChild(element);

  let next = element.nextSibling;
  if (!next || next.nodeType !== Node.ELEMENT_NODE || next.tagName !== 'P') {
    next = document.createElement('p');
    next.appendChild(document.createElement('br'));
    element.after(next);
  }
  if (caretTarget) placeCaretInside(caretTarget, true);
  else placeCaretInside(next);
  markEditorDirty();
}

function insertCallout(type) {
  if (!CALLOUT_TYPES[type]) return;
  const range = restoreSelection();
  const selectedText = range.toString().trim();
  if (selectedText) range.deleteContents();
  const box = document.createElement('div');
  box.className = 'callout callout-' + type;
  const p = document.createElement('p');
  p.textContent = selectedText || CALLOUT_TYPES[type];
  box.appendChild(p);
  insertBlockElement(box, selectedText ? null : p);
}

/* ---- Dialogs used by the editor ---- */

function openEditorDialog(dialogSelector, focusSelector) {
  rememberSelection();
  const dialog = $(dialogSelector);
  const form = dialog.querySelector('form');
  form.reset();
  showFormErrors(form, {});
  openDialog(dialog);
  const focusEl = $(focusSelector);
  if (focusEl) focusEl.focus();
}

function handleTableSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const rows = Number(form.elements.rows.value);
  const cols = Number(form.elements.cols.value);
  const errors = {};
  if (!Number.isInteger(rows) || rows < 1 || rows > 30) errors.rows = 'Enter 1 to 30 rows.';
  if (!Number.isInteger(cols) || cols < 1 || cols > 10) errors.cols = 'Enter 1 to 10 columns.';
  if (showFormErrors(form, errors)) return;
  closeDialog($('#tableDialog'));

  const table = document.createElement('table');
  if (form.elements.header.checked) {
    const thead = table.createTHead();
    const tr = thead.insertRow();
    for (let c = 0; c < cols; c++) {
      const th = document.createElement('th');
      th.textContent = 'Heading ' + (c + 1);
      tr.appendChild(th);
    }
  }
  const tbody = table.createTBody();
  for (let r = 0; r < rows; r++) {
    const tr = tbody.insertRow();
    for (let c = 0; c < cols; c++) tr.insertCell().appendChild(document.createElement('br'));
  }
  const firstCell = table.querySelector('th, td');
  insertBlockElement(table, firstCell);
  toast('Table inserted. Click inside it and use +Row / +Col to change its size.', 'info');
}

/** The table cell that currently contains the cursor (or null). */
function currentTableCell() {
  const area = getEditorArea();
  const range = editor.savedRange;
  if (!area || !range) return null;
  let node = range.startContainer;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  const cell = node ? node.closest('td, th') : null;
  return cell && area.contains(cell) ? cell : null;
}

function newCell(tagName) {
  const cell = document.createElement(tagName);
  cell.appendChild(document.createElement('br'));
  return cell;
}

function tableCommand(cmd) {
  rememberSelection();
  const cell = currentTableCell();
  if (!cell) {
    toast('Click inside a table cell first, then use this button.', 'info');
    return;
  }
  const row = cell.parentElement;
  const table = cell.closest('table');
  const index = cell.cellIndex;
  let focusCell = null;

  if (cmd === 'rowAdd') {
    const tr = document.createElement('tr');
    for (let i = 0; i < row.cells.length; i++) tr.appendChild(newCell('td'));
    if (row.parentElement.tagName === 'THEAD') {
      const tbody = table.tBodies[0] || table.createTBody();
      tbody.insertBefore(tr, tbody.firstChild);
    } else {
      row.after(tr);
    }
    focusCell = tr.cells[Math.min(index, tr.cells.length - 1)];
  } else if (cmd === 'colAdd') {
    Array.from(table.rows).forEach(r => {
      const tag = r.parentElement.tagName === 'THEAD' ? 'th' : 'td';
      const c = newCell(tag);
      const ref = r.cells[index];
      if (ref) ref.after(c); else r.appendChild(c);
      if (r === row) focusCell = c;
    });
  } else if (cmd === 'rowDelete') {
    if (table.rows.length <= 1) { removeTable(table); return; }
    const rows = Array.from(table.rows);
    const pos = rows.indexOf(row);
    const section = row.parentElement;
    row.remove();
    if (!section.rows.length) section.remove();
    const neighbour = table.rows[Math.min(pos, table.rows.length - 1)];
    focusCell = neighbour ? neighbour.cells[Math.min(index, neighbour.cells.length - 1)] : null;
  } else if (cmd === 'colDelete') {
    if (row.cells.length <= 1) { removeTable(table); return; }
    Array.from(table.rows).forEach(r => { if (r.cells[index]) r.cells[index].remove(); });
    focusCell = row.cells[Math.min(index, row.cells.length - 1)];
  } else if (cmd === 'tableDelete') {
    removeTable(table);
    return;
  }
  if (focusCell) placeCaretInside(focusCell);
  markEditorDirty();
}

function removeTable(table) {
  const p = document.createElement('p');
  p.appendChild(document.createElement('br'));
  table.replaceWith(p);
  placeCaretInside(p);
  markEditorDirty();
  toast('Table removed. Press Cancel without saving if this was a mistake.', 'info');
}

/** The <pre> code block that contains the cursor (or null). */
function currentPre() {
  const area = getEditorArea();
  const range = editor.savedRange;
  if (!area || !range) return null;
  let node = range.startContainer;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  const pre = node ? node.closest('pre') : null;
  return pre && area.contains(pre) ? pre : null;
}

function openCodeDialog() {
  rememberSelection();
  const pre = currentPre();
  editor.editingPre = pre;
  const form = $('#codeForm');
  form.reset();
  showFormErrors(form, {});
  $('#codeDialogTitle').textContent = pre ? 'Edit code block' : 'Insert code block';
  let initial = '';
  if (pre) initial = pre.textContent.replace(/\n$/, '');
  else if (editor.savedRange) initial = editor.savedRange.toString();
  form.elements.code.value = initial;
  openDialog($('#codeDialog'));
  form.elements.code.focus();
}

function handleCodeSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const code = form.elements.code.value.replace(/\s+$/, '');
  if (showFormErrors(form, code.trim() ? {} : { code: 'Type or paste some code first.' })) return;
  closeDialog($('#codeDialog'));

  const codeEl = document.createElement('code');
  codeEl.textContent = code;
  if (editor.editingPre && getEditorArea().contains(editor.editingPre)) {
    editor.editingPre.replaceChildren(codeEl);
    placeCaretInside(editor.editingPre);
    markEditorDirty();
  } else {
    const range = restoreSelection();
    if (!range.collapsed) range.deleteContents();
    const pre = document.createElement('pre');
    pre.appendChild(codeEl);
    insertBlockElement(pre);
  }
  editor.editingPre = null;
}

function openLinkDialog() {
  rememberSelection();
  const form = $('#linkForm');
  form.reset();
  showFormErrors(form, {});
  form.elements.text.value = editor.savedRange ? editor.savedRange.toString().trim() : '';
  openDialog($('#linkDialog'));
  form.elements.url.focus();
}

function handleLinkSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const url = form.elements.url.value.trim();
  const text = form.elements.text.value.trim();
  if (showFormErrors(form, /^(https?:\/\/|mailto:)[^\s"'<>]+$/i.test(url) ? {} : { url: 'Enter a full address starting with https://, http:// or mailto:' })) return;
  closeDialog($('#linkDialog'));

  const range = restoreSelection();
  const link = document.createElement('a');
  link.href = url;
  link.textContent = text || url;
  range.deleteContents();
  range.insertNode(link);
  placeCaretAfter(link);
  markEditorDirty();
}

/* ---- Images ---- */

/** Reads an image file, shrinks big images and returns a data: URL. */
function processImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      reject(new Error('Please choose a PNG, JPG, GIF or WEBP image.'));
      return;
    }
    if (file.size > MAX_IMAGE_FILE_BYTES) {
      reject(new Error('That image is larger than 10 MB. Please choose a smaller image.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image file.'));
    reader.onload = () => {
      const original = reader.result;
      if (file.type === 'image/gif') {
        // GIFs are kept as they are (resizing would remove animation).
        if (file.size > 1024 * 1024) reject(new Error('GIF images must be smaller than 1 MB.'));
        else resolve(original);
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('The file is not a valid image.'));
      img.onload = () => {
        const small = img.naturalWidth <= MAX_IMAGE_WIDTH && file.size <= 400 * 1024;
        if (small) { resolve(original); return; }
        const scale = Math.min(1, MAX_IMAGE_WIDTH / img.naturalWidth);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; // white background for transparent PNGs
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = original;
    };
    reader.readAsDataURL(file);
  });
}

function buildFigure(src, alt, caption) {
  const figure = document.createElement('figure');
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt || caption || 'Image';
  figure.appendChild(img);
  if (caption) {
    const figcaption = document.createElement('figcaption');
    figcaption.textContent = caption;
    figure.appendChild(figcaption);
  }
  return figure;
}

async function handleImageSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const file = form.elements.file.files[0];
  const url = form.elements.url.value.trim();
  const alt = form.elements.alt.value.trim();
  const caption = form.elements.caption.value.trim();

  if (!file && !url) { showFormErrors(form, { file: 'Choose an image file or enter an image address.' }); return; }
  if (!file && !/^https?:\/\/[^\s"'<>]+$/i.test(url)) { showFormErrors(form, { file: 'The image address must start with https:// or http://' }); return; }

  let src = url;
  if (file) {
    try {
      src = await processImageFile(file);
    } catch (err) {
      showFormErrors(form, { file: err.message });
      return;
    }
  }
  closeDialog($('#imageDialog'));
  insertBlockElement(buildFigure(src, alt, caption));
  toast('Image inserted. Remember to save the topic.', 'info');
}

async function insertImageFile(file, alt) {
  try {
    const src = await processImageFile(file);
    insertBlockElement(buildFigure(src, alt, ''));
    toast('Image added. Remember to save the topic.', 'info');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---- Keyboard, paste and drop inside the editor ---- */

function handleEditorKeydown(event) {
  // Ctrl+S / Cmd+S saves
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveEditor(false);
    return;
  }
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  let node = range.startContainer;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  const pre = node ? node.closest('pre') : null;
  if (!pre || !getEditorArea().contains(pre)) return;

  // Inside a code block: Enter makes a new line (not a new paragraph), Tab adds 4 spaces.
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    insertTextInPre(range, pre, '\n');
  } else if (event.key === 'Tab') {
    event.preventDefault();
    insertTextInPre(range, pre, '    ');
  }
}

function insertTextInPre(range, pre, text) {
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  // A newline at the very end of a <pre> is invisible, so add a second one.
  const rest = document.createRange();
  rest.setStartAfter(node);
  rest.setEndAfter(pre.lastChild || pre);
  if (text === '\n' && rest.toString() === '') node.after(document.createTextNode('\n'));
  placeCaretAfter(node);
  markEditorDirty();
}

function handleEditorPaste(event) {
  const clipboard = event.clipboardData;
  if (!clipboard) return;
  event.preventDefault();
  rememberSelection();

  const imageFile = Array.from(clipboard.files || []).find(f => f.type.startsWith('image/'));
  if (imageFile) { insertImageFile(imageFile, 'Pasted image'); return; }

  const html = clipboard.getData('text/html');
  const text = clipboard.getData('text/plain');
  const range = restoreSelection();
  if (currentPre()) {
    // Inside a code block: paste as plain text, keeping line breaks exactly.
    insertTextInPre(range, currentPre(), text.replace(/\r\n?/g, '\n'));
    return;
  }
  if (!html) {
    document.execCommand('insertText', false, text);
  } else {
    const clean = Sanitizer.sanitize(html);
    if (clean) document.execCommand('insertHTML', false, clean);
    else document.execCommand('insertText', false, text);
  }
  markEditorDirty();
}

function handleEditorDrop(event) {
  // Dropped content is blocked because it could bypass the safety filter.
  event.preventDefault();
  const files = event.dataTransfer ? Array.from(event.dataTransfer.files) : [];
  const imageFile = files.find(f => f.type.startsWith('image/'));
  if (imageFile) {
    rememberSelection();
    insertImageFile(imageFile, imageFile.name.replace(/\.[^.]+$/, ''));
  } else {
    toast('Drag and drop is turned off in the editor. Please use copy and paste instead.', 'info');
  }
}

/* ---- Save / cancel ---- */

function saveEditor(andView) {
  const area = getEditorArea();
  const form = $('#editorForm');
  if (!area || !form) return;
  const { weekId, topicId } = state.route;
  const title = $('#editorTitle').value.trim();
  const status = $('#editorStatus').value;
  const errors = {};
  if (!title) errors.title = 'The topic needs a title.';
  else if (title.length > LIMITS.title) errors.title = 'The title is too long (maximum ' + LIMITS.title + ' characters).';
  if (showFormErrors(form, errors)) {
    toast('Not saved: please fix the highlighted field.', 'error');
    return;
  }
  let content = Sanitizer.sanitize(area.innerHTML.replace(/​/g, ''));
  if (Sanitizer.isEmpty(content)) content = '';

  const ok = updateData(() => {
    const found = findTopic(weekId, topicId);
    if (!found) throw new Error('This topic no longer exists, so it could not be saved.');
    found.topic.title = title;
    found.topic.status = TOPIC_STATUSES.includes(status) ? status : 'pending';
    found.topic.content = content;
    found.topic.updatedAt = new Date().toISOString();
  }, 'Topic saved.');
  if (!ok) return;

  state.editorDirty = false;
  if (andView) {
    navigate(routes.topic(weekId, topicId));
    return;
  }
  const label = $('#editorSaveState');
  label.textContent = 'All changes saved at ' + new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  label.classList.remove('is-dirty');
  $('#editorHeading').textContent = 'Edit: ' + title;
  renderSidebar();
}

async function cancelEditor() {
  const { weekId, topicId } = state.route;
  if (state.editorDirty) {
    const ok = await confirmAction({
      title: 'Discard changes?',
      message: 'Your unsaved changes to this topic will be lost.',
      confirmText: 'Discard changes'
    });
    if (!ok) return;
  }
  state.editorDirty = false;
  navigate(findTopic(weekId, topicId) ? routes.topic(weekId, topicId) : routes.dashboard());
}

/* =========================================================
   11. BACKUP: EXPORT, IMPORT, RESET
   ========================================================= */

function exportBackup() {
  const stamp = new Date().toISOString();
  // Record the export time first (so "Last export" is correct), then download.
  updateData(data => { data.meta.lastExportAt = stamp; });
  const json = JSON.stringify(state.data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const filename = 'os-course-backup-' + todayString() + '.json';
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Backup downloaded as "' + filename + '". Check your Downloads folder.', 'success');
  if (state.route.name === 'data') refresh();
}

async function handleImportFile(event) {
  const input = event.target;
  const file = input.files[0];
  input.value = ''; // lets you pick the same file again later
  if (!file) return;

  const showErrors = (title, list) => {
    const box = $('#importErrors');
    const html = '<div class="notice notice-error" role="alert"><p><strong>' + esc(title) + '</strong> Your current data was not changed.</p>' +
      (list && list.length ? '<ul>' + list.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul>' : '') + '</div>';
    if (box) box.innerHTML = html;
    toast(title + ' Your current data was not changed.', 'error');
  };
  const box = $('#importErrors');
  if (box) box.innerHTML = '';

  if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
    showErrors('Import failed: please choose a .json backup file.');
    return;
  }
  if (file.size > MAX_IMPORT_BYTES) {
    showErrors('Import failed: the file is too large (over 30 MB).');
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (err) {
    showErrors('Import failed: the file is not valid JSON.', [err.message]);
    return;
  }
  const result = validateCourseData(parsed);
  if (!result.ok) {
    showErrors('Import failed: the backup has problems.', result.errors);
    return;
  }

  const incoming = result.data;
  const count = d => plural(d.weeks.length, 'week') + ', ' + plural(d.weeks.reduce((s, w) => s + w.topics.length, 0), 'topic') + ', ' + plural(d.assignments.length, 'assignment');
  const ok = await confirmAction({
    title: 'Replace current data?',
    message: 'The file "' + file.name + '" is a valid backup.\n\nBackup contains: ' + count(incoming) +
      '\nCurrent data: ' + count(state.data) + '\n\nImporting will REPLACE all current data. Export your current data first if you want to keep it.',
    confirmText: 'Replace with backup'
  });
  if (!ok) { toast('Import cancelled. Nothing was changed.', 'info'); return; }
  if (replaceAllData(incoming, 'Backup imported successfully.')) navigate(routes.dashboard());
}

async function resetCourse(kind) {
  const sample = kind === 'sample';
  const ok = await confirmAction({
    title: sample ? 'Restore sample data?' : 'Start with an empty course?',
    message: (sample
      ? 'This replaces ALL your weeks, topics and assignments with the sample Operating Systems course.'
      : 'This deletes ALL your weeks, topics and assignments and gives you an empty course.') +
      '\n\nThis cannot be undone. Export a backup first if you want to keep your current data.',
    confirmText: sample ? 'Replace with sample data' : 'Delete everything'
  });
  if (!ok) return;
  const title = state.data.course.title || 'Operating Systems';
  const fresh = sample ? createSampleData() : createEmptyData(title);
  if (replaceAllData(fresh, sample ? 'Sample data restored.' : 'Empty course created. Click "+ Add Week" to begin.')) {
    state.editorDirty = false;
    navigate(routes.dashboard());
  }
}

/* =========================================================
   12. EVENT WIRING AND START-UP
   ========================================================= */

function wireEvents() {
  // One click handler for every data-action button in the whole app.
  document.addEventListener('click', event => {
    const closer = event.target.closest('[data-close-dialog]');
    if (closer) {
      closeDialog(closer.closest('dialog'));
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = actions[button.dataset.action];
    if (!action) {
      console.warn('No action for', button.dataset.action);
      return;
    }
    event.preventDefault();
    Promise.resolve(action(button.dataset, button)).catch(err => {
      console.error(err);
      toast('Something went wrong: ' + err.message, 'error');
    });
  });

  // Dropdowns that change data immediately (assignment status).
  document.addEventListener('change', event => {
    const select = event.target.closest('[data-change="assignment-status"]');
    if (!select) return;
    const a = findAssignment(select.dataset.assignmentId);
    if (!a || !ASSIGNMENT_STATUSES[select.value]) return;
    const value = select.value;
    if (updateData(() => { a.status = value; }, 'Status changed to "' + ASSIGNMENT_STATUSES[value] + '".')) {
      renderAssignmentList();
      renderSidebar();
    } else {
      select.value = a.status;
    }
  });

  // Assignment search and filter (redraws only the list).
  document.addEventListener('input', event => {
    if (event.target.id === 'assignmentSearch') {
      state.assignmentFilter.text = event.target.value;
      renderAssignmentList();
    }
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'assignmentStatusFilter') {
      state.assignmentFilter.status = event.target.value;
      renderAssignmentList();
    }
  });

  // Course settings form is drawn dynamically, so listen on the document.
  document.addEventListener('submit', event => {
    if (event.target.id === 'courseForm') handleCourseSubmit(event);
  });

  // Global search
  $('#searchForm').addEventListener('submit', event => {
    event.preventDefault();
    const q = $('#searchInput').value.trim();
    if (!q) {
      toast('Type something to search for.', 'info');
      $('#searchInput').focus();
      return;
    }
    navigate(routes.search(q));
  });
  $('#searchInput').addEventListener('input', event => {
    // Live results while you type, but only when already on the search page.
    if (state.route.name !== 'search') return;
    history.replaceState(null, '', routes.search(event.target.value.trim()));
    refresh();
  });

  // Dialog forms
  $('#weekForm').addEventListener('submit', handleWeekSubmit);
  $('#topicForm').addEventListener('submit', handleTopicSubmit);
  $('#assignmentForm').addEventListener('submit', handleAssignmentSubmit);
  $('#tableForm').addEventListener('submit', handleTableSubmit);
  $('#codeForm').addEventListener('submit', handleCodeSubmit);
  $('#imageForm').addEventListener('submit', handleImageSubmit);
  $('#linkForm').addEventListener('submit', handleLinkSubmit);
  $('#importFile').addEventListener('change', handleImportFile);

  // Mobile menu
  $('#menuToggle').addEventListener('click', () => {
    if ($('#sidebar').classList.contains('is-open')) closeSidebar(); else openSidebar();
  });
  $('#sidebarOverlay').addEventListener('click', closeSidebar);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('#sidebar').classList.contains('is-open')) closeSidebar();
  });
  $('#sidebar').addEventListener('click', event => {
    if (event.target.closest('a')) closeSidebar();
  });

  // Editor helpers
  document.addEventListener('selectionchange', rememberSelection);

  // Routing and leaving the page
  window.addEventListener('hashchange', handleHashChange);
  window.addEventListener('beforeunload', event => {
    if (state.editorDirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  // If the app is open in two tabs, pick up changes made in the other tab.
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY || event.newValue === null) return;
    if (state.editorDirty) {
      toast('The data was changed in another tab. Save or cancel here, then reload the page.', 'info');
      return;
    }
    try {
      const result = validateCourseData(JSON.parse(event.newValue));
      if (result.ok) {
        state.data = result.data;
        render(false);
        toast('Updated with changes made in another tab.', 'info');
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Show unexpected errors instead of failing silently.
  window.addEventListener('error', event => {
    toast('Unexpected error: ' + (event.message || 'unknown') + '. Your saved data is safe; try reloading the page.', 'error');
  });
}

function init() {
  const loaded = loadFromStorage();
  state.data = loaded.data;

  if (loaded.status === 'first-run') {
    const result = saveToStorage(state.data);
    if (result.ok) toast('Welcome! A sample Operating Systems course was loaded so you can explore. Go to "Backup & Data" to start with an empty course.', 'info');
    else { state.memoryOnly = true; showBanner('Your browser is not allowing this page to save data. Changes will be lost when you close the tab. ' + result.error, 'error'); }
  } else if (loaded.status === 'unavailable') {
    state.memoryOnly = true;
    showBanner('Your browser blocked local storage (this can happen in private windows or with strict privacy settings). Changes will be lost when you close the tab - use "Export backup" to keep your work.', 'error');
  } else if (loaded.status === 'damaged') {
    if (loaded.copied) {
      showBanner('Your saved data could not be read: ' + loaded.errors.slice(0, 2).join(' ') + ' A copy was kept in browser storage under "' + loaded.copyKey + '". An empty course was opened. You can import a backup from "Backup & Data".', 'error');
    } else {
      state.saveBlocked = true;
      showBanner('Your saved data could not be read, and there was no space to keep a copy. Saving is turned OFF so the old data is not overwritten. Import a backup or choose "Start with an empty course" in "Backup & Data" to continue.', 'error');
    }
  }

  wireEvents();
  if (!location.hash) history.replaceState(null, '', routes.dashboard());
  refresh();
}

document.addEventListener('DOMContentLoaded', init);
