'use strict';
// Tiny JSON-file store with atomic writes. Plenty for one event dashboard.
// If you ever need many concurrent editors, swap this file for SQLite/Postgres.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

const STATE_FILE = path.join(DATA_DIR, 'state.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');

const events = new EventEmitter();
const uid = () => crypto.randomUUID();

function atomicWrite(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function defaults() {
  return {
    rev: 1,
    event: {
      title: 'RoboDash',
      subtitle: 'Provorant 1.0 · Inter-Faculty Line Following Robot Competition',
      venue: 'SLT MNIT Auditorium',
      startsAt: '2026-12-16T09:00:00+05:30',
      logo: ''
    },
    settings: {
      timezone: 'Asia/Colombo',
      teamSeconds: 9,
      orgSeconds: 10,
      adSeconds: 12,
      tickerSeconds: 8
    },
    stream: {
      enabled: false,
      muted: true,
      url: '',
      ref: null,
      title: 'RoboDash Live',
      standbyMessage: 'Live stream starting soon'
    },
    emergencyVideo: {
      enabled: false,
      type: 'youtube',
      url: '',
      ref: null,
      videoPath: ''
    },
    ticker: [
      { id: uid(), text: 'Line following robots read the track with infrared sensors and correct their steering many times every second.', active: true },
      { id: uid(), text: 'PID control keeps a robot smooth on the line: P reacts to the error, I removes drift, D calms the wobble.', active: true },
      { id: uid(), text: 'Teams of three · 1st and 2nd place win certificates and cash prizes.', active: true }
    ],
    ads: [],
    teams: [
      { id: uid(), name: 'Team Alpha', university: 'Sample University', country: 'Sri Lanka', countryCode: 'LK', members: ['Member One', 'Member Two', 'Member Three'], robot: 'Robot name', blurb: 'Replace this sample team from the admin panel.', photo: '', status: 'waiting', active: true }
    ],
    org: [
      { id: uid(), kind: 'campus', title: 'SLT-Mobitel Nebula Institute of Technology', body: 'The education arm of SLT-Mobitel, formerly the SLT Training Centre, recognised by the University Grants Commission. nebula.edu.lk · 011 216 2162', image: '', active: true },
      { id: uid(), kind: 'course', title: 'HND in Electrical & Electronic Engineering', body: 'Pearson BTEC Higher National Diploma with hands-on, industry-linked training. Edit this slide to match the current intake.', image: '', active: true },
      { id: uid(), kind: 'course', title: 'HND in Digital Technologies & Computing', body: 'Foundation diplomas for school leavers and top-up degree pathways are also available. Edit this slide to match the current intake.', image: '', active: true }
    ]
  };
}

let state = readJson(STATE_FILE, null);
if (!state) { state = defaults(); atomicWrite(STATE_FILE, state); }
// Fill in any keys added in newer versions so old state files keep working.
const d = defaults();
for (const k of Object.keys(d)) if (state[k] === undefined) state[k] = d[k];
for (const k of ['event', 'settings', 'stream', 'emergencyVideo']) state[k] = { ...d[k], ...state[k] };

const getState = () => state;

// All writes go through mutate(): bumps the revision, persists, notifies SSE clients.
function mutate(fn) {
  const result = fn(state);
  state.rev += 1;
  atomicWrite(STATE_FILE, state);
  events.emit('change', state.rev);
  return result;
}

const getUsers = () => readJson(USERS_FILE, []);
const saveUsers = (u) => atomicWrite(USERS_FILE, u);

function audit(user, ip, action, detail = '') {
  const line = JSON.stringify({ t: new Date().toISOString(), user, ip, action, detail: String(detail).slice(0, 200) }) + '\n';
  try { fs.appendFileSync(AUDIT_FILE, line, { mode: 0o600 }); } catch { /* never crash on logging */ }
}

module.exports = { getState, mutate, getUsers, saveUsers, audit, events, uid, DATA_DIR };
