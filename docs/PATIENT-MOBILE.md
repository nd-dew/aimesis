# Standalone patient app

The parent/carer diary is a separate frontend entry point at `/patient/<token>`,
built from `frontend/patient.html`. The existing clinician app and `/m/<token>`
companion keep their existing components, severity scale, request/response
contracts, and data.

The new app uses `/api/patient-mobile/<token>` and its log/undo routes. It
reuses the existing patient's private link token; no new accounts are needed.
Its reports are stored separately in
`backend/data/runtime/patient_mobile_logs.json`. Nausea levels are 0 (none), 1
(a little), 2 (quite), and 3 (very). Vomiting is a separate symptom with no
nausea score. These labels are prototype UX wording, not a validated clinical
measurement instrument.

An additional **Patient app check-ins** section in the clinician tracker reads
`/api/patients/<patient_id>/patient-mobile-logs` using the existing clinician
authentication. It shows all new app check-ins, including no nausea, without
converting them to the old severity 1–5 scale. The section offers **Get patient
app link** to explicitly create/retrieve a non-rotating link, followed by **Open
patient app**, plus manual history refresh. Merely reading the tracker never
creates a link. The link uses the backend’s configured PUBLIC_BASE_URL, so a
Vite development clinician page opens the built patient app through FastAPI.
Existing tracker controls/history are unchanged. New app reports are also read
as prior-cycle evidence: vomiting or positive nausea in the previous-cycle
window can set had_prior_nausea. A no-nausea check-in cannot clear positive
history. Legacy records and their interpretation are unchanged.

The single-patient main UI has a **Patient** QR control in its header.
Opening it explicitly requests the clinician-protected
`/api/patients/<patient_id>/patient-mobile-link` endpoint. Its QR and clickable
URL point to `/patient/<token>` without rotating an existing token. The older
`companion-link` endpoint continues to return `/m/<token>`.

The clinician uses the same main UI on phones and desktops; there is no
separate clinician mobile app or QR code. On phones, patient details start
collapsed, recommendations stack by medication, and history uses a compact
single-column timeline. Desktop retains the resizable patient panel.

The patient app assumes a parent/carer is entering the report. There is no
reporter selector, medication schedule, hospital-contact card, or clinician
identity invented in the copy. Four native radio choices have no default
selection. Save records the level and time; the separate vomiting button records
vomiting. Confirmation offers Undo for 10 seconds (the server permits undo
within 10 minutes). Today's counts and diary use Europe/Brussels time; no-nausea
check-ins do not raise the positive nausea count.

NL, FR, and EN text, light/dark appearance, native keyboard controls, and large
touch targets are included. On network failure, writes are queued per patient
link and retried on page load or reconnection. Server-rejected writes are not
queued. A phone-only queued report is identified as unsent.

## Run and deploy

Run `npm ci && npm run build` in `frontend/`, then start the existing FastAPI
app as described in RUNNING.md. The build runs the existing Vite build plus a
separate patient build under dist/patient; the existing Dockerfile/deploy.sh
packages them together. No extra service or dependency is needed. A development
preview requires the built patient.html because its route is served by FastAPI.
For phone testing, bind FastAPI to `0.0.0.0` and set PUBLIC_BASE_URL to its
phone-reachable LAN URL (for example `http://192.168.1.20:8000`). The phone and
computer must share that network. On Cloud Run, set PUBLIC_BASE_URL to the
service's HTTPS URL.

This app inherits the existing demo's JSON storage limits. Cloud Run image
builds exclude runtime data, and this deployment has no durable volume. Logs and
private patient links are not carried into a new revision. There is no
notification, urgent response, or automatic medication-change service.
