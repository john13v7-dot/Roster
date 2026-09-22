import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, deleteDoc, getDoc, updateDoc,
  onSnapshot, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);

const $ = (id) => document.getElementById(id);
const toastEl = $("toast");
function toast(msg, ms) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), ms || 4200);
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function fmtWhen(ts) {
  // Firestore Timestamp (has toDate()) or a plain ISO string - handle both,
  // since the seed data and the Cloud Function don't write the same shape.
  if (!ts) return "";
  const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return String(ts);
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// ---------- sign-in ----------
$("refreshBtn").onclick = () => { $("refreshBtn").classList.add("spin"); location.reload(); };

$("signInBtn").onclick = () => signInWithRedirect(auth, new GoogleAuthProvider());
$("signOutBtn").onclick = () => signOut(auth);

getRedirectResult(auth).catch((e) => { $("signInErr").textContent = e.message || "Sign-in failed."; });

onAuthStateChanged(auth, (user) => {
  if (user) {
    $("signInScreen").classList.add("hidden");
    $("appRoot").classList.remove("hidden");
    startApp();
  } else {
    $("signInScreen").classList.remove("hidden");
    $("appRoot").classList.add("hidden");
  }
});

let started = false;
function startApp() {
  if (started) return; // onAuthStateChanged can fire more than once for the same session
  started = true;

  // ---------- screen navigation ----------
  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    window.scrollTo(0, 0);
  }
  $("requestsTopBtn").onclick = () => showScreen("requestsScreen");
  $("dutiesTopBtn").onclick = () => showScreen("dutiesScreen");
  $("fairnessTopBtn").onclick = () => showScreen("fairnessScreen");
  document.querySelectorAll(".backbtn").forEach((btn) => { btn.onclick = () => showScreen(btn.dataset.back); });

  // ---------- roster (home screen) ----------
  let data = null;

  function pillClass(kind, text) {
    if (kind === "vacant") return "daypill-vacant";
    if (kind === "leave") {
      const t = text.trim().toLowerCase();
      if (t === "off") return "daypill-off";
      if (t.indexOf("holiday") !== -1) return "daypill-holiday";
      if (t.indexOf("maternity") !== -1) return "daypill-maternity";
      return "daypill-off";
    }
    return "";
  }

  function renderRosterStatus() {
    const el = $("rosterStatus");
    el.innerHTML = "";
    if (data && data.error) {
      const row = document.createElement("div");
      row.className = "status-row status-bad";
      row.textContent = data.error;
      el.appendChild(row);
    }
  }

  function renderWeeks() {
    const tabsEl = $("tabs"), weeksEl = $("weeks");
    tabsEl.innerHTML = ""; weeksEl.innerHTML = "";
    if (!data || !data.weeks) return;

    data.weeks.forEach((week, wi) => {
      const tab = document.createElement("div");
      tab.className = "tab" + (wi === 0 ? " active" : "");
      tab.textContent = "Week " + (wi + 1);
      tab.onclick = () => selectWeek(wi);
      tabsEl.appendChild(tab);

      const wrap = document.createElement("div");
      wrap.className = "week card" + (wi === 0 ? " active" : "");
      wrap.id = "week-" + wi;

      const heading = document.createElement("div");
      heading.style.cssText = "font-size:13px; font-weight:800; margin-bottom:10px;";
      heading.textContent = week.label;
      wrap.appendChild(heading);

      if (week.breaches.length || week.warnings.length) {
        const status = document.createElement("div");
        status.className = "status-row " + (week.breaches.length ? "status-bad" : "status-warn");
        status.textContent = week.breaches.length
          ? (week.breaches.length + " cover breach" + (week.breaches.length > 1 ? "es" : "") + " this week")
          : (week.warnings.length + " thing" + (week.warnings.length > 1 ? "s" : "") + " worth checking");
        wrap.appendChild(status);

        week.breaches.concat(week.warnings).forEach((msg, i) => {
          const isBad = i < week.breaches.length;
          const line = document.createElement("div");
          line.className = "msg-line " + (isBad ? "msg-bad" : "msg-warn");
          line.textContent = (isBad ? "Breach: " : "Check: ") + msg;
          wrap.appendChild(line);
        });
      }

      week.people.forEach((p) => {
        const row = document.createElement("div");
        row.className = "personrow";
        const head = document.createElement("div");
        head.className = "personhead";
        const nm = document.createElement("span");
        nm.className = "personname";
        nm.textContent = p.name;
        head.appendChild(nm);
        if (p.role === "vacant") {
          const rl = document.createElement("span");
          rl.className = "personrole";
          rl.textContent = "vacant";
          head.appendChild(rl);
        }
        row.appendChild(head);

        const pills = document.createElement("div");
        pills.className = "daypills";
        p.days.forEach((dcell, di) => {
          const pill = document.createElement("div");
          pill.className = "daypill " + pillClass(dcell.kind, dcell.text);
          const lbl = document.createElement("div");
          lbl.className = "dlabel";
          lbl.textContent = week.day_names[di];
          const txt = document.createElement("div");
          txt.className = "dtext";
          txt.textContent = dcell.text || "—";
          pill.appendChild(lbl);
          pill.appendChild(txt);
          pills.appendChild(pill);
        });
        row.appendChild(pills);
        wrap.appendChild(row);
      });

      if (week.notes.length) {
        const det = document.createElement("details");
        det.style.marginTop = "10px";
        const sum = document.createElement("summary");
        sum.style.cssText = "font-size:11.5px; color:var(--ink-dim); font-weight:600;";
        sum.textContent = week.notes.length + " scheduling note" + (week.notes.length > 1 ? "s" : "");
        det.appendChild(sum);
        week.notes.forEach((msg) => {
          const p2 = document.createElement("p");
          p2.className = "note";
          p2.textContent = msg;
          det.appendChild(p2);
        });
        wrap.appendChild(det);
      }

      weeksEl.appendChild(wrap);
    });
  }

  function selectWeek(i) {
    document.querySelectorAll("#tabs .tab").forEach((t, idx) => t.classList.toggle("active", idx === i));
    document.querySelectorAll(".week").forEach((w, idx) => w.classList.toggle("active", idx === i));
  }

  // ---------- duties ----------
  const CONTEXT_DUTIES = { "Cot Room": 1, "Changing Area": 1 };
  const FIXED_DUTIES = { "Dusting": 1, "Laundry": 1 };

  function renderDutyTabs() {
    const dutyTabsEl = $("dutyTabs");
    dutyTabsEl.innerHTML = "";
    (data && data.duties ? data.duties : []).forEach((_, wi) => {
      const dtab = document.createElement("div");
      dtab.className = "tab" + (wi === 0 ? " active" : "");
      dtab.textContent = "Week " + (wi + 1);
      dtab.onclick = () => selectDutyWeek(wi);
      dutyTabsEl.appendChild(dtab);
    });
  }

  function renderDuties(wi) {
    const week = (data && data.duties ? data.duties : [])[wi];
    const list = $("dutiesList");
    list.innerHTML = "";
    if (!week) { list.innerHTML = '<div class="empty">No duty rota yet.</div>'; return; }
    const unfilled = {};
    (week.unfilled || []).forEach((d) => { unfilled[d] = 1; });
    week.assignments.forEach((a) => {
      const row = document.createElement("div");
      let cls = "dutyrow";
      let peopleText;
      if (CONTEXT_DUTIES[a.duty]) { cls += " context"; peopleText = "Staff working in the room"; }
      else if (unfilled[a.duty]) { cls += " unfilled"; peopleText = "Nobody free this week"; }
      else { peopleText = a.people.join(" / ") || "—"; if (FIXED_DUTIES[a.duty]) cls += " fixed"; }
      row.className = cls;
      row.innerHTML = '<div class="dname">' + esc(a.duty) + '</div><div class="dpeople">' + esc(peopleText) + "</div>";
      list.appendChild(row);
    });
  }
  function selectDutyWeek(i) {
    document.querySelectorAll("#dutyTabs .tab").forEach((t, idx) => t.classList.toggle("active", idx === i));
    renderDuties(i);
  }

  // ---------- fairness ----------
  const SHIFT_COLS = [["early", "Opening"], ["mid1", "8:00"], ["mid2", "8:30"], ["late", "Closing"]];
  function renderFairness() {
    const fair = (data && data.fairness) || { shifts: [], duties: [] };

    const st = document.createElement("table");
    st.className = "fairtable";
    const sthead = "<tr><th>Name</th>" + SHIFT_COLS.map((c) => "<th>" + c[1] + "</th>").join("") + "</tr>";
    const strows = fair.shifts.map((row) => (
      "<tr><td>" + esc(row.name) + "</td>" + SHIFT_COLS.map((c) => "<td>" + row[c[0]] + "</td>").join("") + "</tr>"
    )).join("");
    st.innerHTML = sthead + strows;
    const shiftHost = $("shiftFairTable");
    shiftHost.innerHTML = "";
    if (fair.shifts.length) shiftHost.appendChild(st);
    else shiftHost.innerHTML = '<div class="empty">No rotating staff to show yet.</div>';

    const dt = document.createElement("table");
    dt.className = "fairtable";
    const dthead = "<tr><th>Name</th><th>Duties done</th></tr>";
    const dtrows = fair.duties.map((row) => "<tr><td>" + esc(row.name) + "</td><td>" + row.duties + "</td></tr>").join("");
    dt.innerHTML = dthead + dtrows;
    const dutyHost = $("dutyFairTable");
    dutyHost.innerHTML = "";
    if (fair.duties.length) dutyHost.appendChild(dt);
    else dutyHost.innerHTML = '<div class="empty">No duty rota to show yet.</div>';
  }

  function renderAll() {
    renderRosterStatus();
    renderWeeks();
    renderDutyTabs();
    renderDuties(0);
    renderFairness();
  }

  onSnapshot(doc(db, "roster", "current"), (snap) => {
    data = snap.exists() ? snap.data() : null;
    renderAll();
  }, (err) => {
    $("rosterStatus").innerHTML =
      '<div class="status-row status-bad">Could not load the roster: ' + esc(err.message) + "</div>";
  });

  // ---------- print ----------
  const printBtn = $("printBtn");
  function triggerDownload(url, filename) {
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.rel = "noopener"; a.target = "_blank";
    document.body.appendChild(a); a.click(); a.remove();
  }
  printBtn.onclick = async () => {
    if (!data || !data.files) { toast("No roster built yet."); return; }
    printBtn.disabled = true;
    try {
      const xlsxUrl = await getDownloadURL(ref(storage, data.files.xlsx));
      const pdfUrl = await getDownloadURL(ref(storage, data.files.pdf));
      triggerDownload(xlsxUrl, "Roster_Planner.xlsx");
      triggerDownload(pdfUrl, "Roster_Planner.pdf");
      toast("Downloading Excel and PDF…");
    } catch (e) {
      toast("Could not fetch the files: " + (e && e.message ? e.message : "try again."));
    }
    printBtn.disabled = false;
  };

  // ---------- staff & requests ----------
  const dialog = $("formDialog"), formTitle = $("formTitle"), formBody = $("formBody"), formErr = $("formErr");
  $("formCancel").onclick = () => dialog.close();
  const formSave = $("formSave");

  let staffDocs = [], leaveDocs = [], transferDocs = [], changeLogDocs = [];
  let logNoteTarget = null;

  function renderStaffList() {
    const el = $("staffList");
    const real = staffDocs.filter((s) => s.role !== "blank" && s.name);
    real.sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!real.length) { el.innerHTML = '<div class="empty">No staff yet.</div>'; return; }
    el.innerHTML = "";
    real.forEach((s) => {
      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML =
        '<div><div class="name">' + esc(s.name) + '</div><div class="meta">' + esc(s.room || "no room set") + "</div></div>" +
        '<span class="pill">' + esc(s.role) + "</span>";
      el.appendChild(row);
    });
  }

  function renderEventList() {
    const el = $("eventList");
    el.innerHTML = "";
    const items = [];
    leaveDocs.forEach((l) => items.push({ type: "leave", doc: l }));
    transferDocs.forEach((t) => items.push({ type: "transfer", doc: t }));
    if (!items.length) { el.innerHTML = '<div class="empty">Nothing on leave, no transfers.</div>'; return; }
    items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "item";
      let label;
      if (it.type === "leave") {
        const l = it.doc;
        row.innerHTML =
          '<div><div class="name">' + esc(l.name) + '</div><div class="meta">' + esc(fmtDate(l.start)) + " – " +
          (l.end ? esc(fmtDate(l.end)) : "until back") + '</div></div><span class="pill leave">' + esc(l.kind) + "</span>";
        label = l.kind + " for " + l.name;
      } else {
        const t = it.doc;
        const tag = t.slot ? ("starts " + esc(t.slot)) : (t.text ? esc(t.text) : "transfer");
        row.innerHTML =
          '<div><div class="name">' + esc(t.name) + '</div><div class="meta">from ' + esc(fmtDate(t.start)) +
          (t.end ? (" to " + esc(fmtDate(t.end))) : "") + '</div></div><span class="pill transfer">' + tag + "</span>";
        label = "the transfer for " + t.name;
      }
      const del = document.createElement("button");
      del.className = "xbtn";
      del.textContent = "✕";
      del.onclick = () => removeDoc(it.type === "leave" ? "leave" : "transfers", it.doc._id, label);
      row.appendChild(del);
      el.appendChild(row);
    });
  }

  const confirmDialog = $("confirmDialog");
  let confirmResolve = null;
  $("confirmCancel").onclick = () => confirmDialog.close();
  $("confirmOk").onclick = () => confirmDialog.close("yes");
  confirmDialog.addEventListener("close", () => {
    if (confirmResolve) { confirmResolve(confirmDialog.returnValue === "yes"); confirmResolve = null; }
  });
  function askConfirm(message) {
    $("confirmBody").textContent = message;
    confirmDialog.returnValue = "";
    try { confirmDialog.showModal(); } catch (e) { return Promise.resolve(true); }
    return new Promise((resolve) => { confirmResolve = resolve; });
  }

  async function removeDoc(collectionName, id, label) {
    if (!id) { toast("Could not remove it — missing id. Refresh and try again."); return; }
    const ok = await askConfirm("Remove " + label + "? The roster will rebuild automatically.");
    if (!ok) return;
    try {
      await deleteDoc(doc(db, collectionName, id));
      toast("Removed. Rebuilding…");
    } catch (e) {
      toast("Could not remove it: " + (e && e.message ? e.message : "try again."));
    }
  }

  function initSync() {
    $("syncDot").className = "dot on";
    $("syncText").textContent = "Connected — changes save and rebuild automatically.";
    document.querySelectorAll(".actionbtn").forEach((b) => { b.disabled = false; });
    printBtn.disabled = false;

    const rebuildNow = httpsCallable(functions, "rebuild_now");
    $("rebuildNowBtn").onclick = async () => {
      $("rebuildNowBtn").disabled = true;
      toast("Rebuilding…");
      try { await rebuildNow(); toast("Rebuilt."); }
      catch (e) { toast("Could not rebuild: " + (e && e.message ? e.message : "try again.")); }
      $("rebuildNowBtn").disabled = false;
    };

    onSnapshot(collection(db, "staff"), (snap) => {
      staffDocs = snap.docs.map((d) => ({ ...d.data(), _id: d.id }));
      renderStaffList();
    }, () => { $("staffList").innerHTML = '<div class="empty">Could not load staff.</div>'; });

    onSnapshot(collection(db, "leave"), (snap) => {
      leaveDocs = snap.docs.map((d) => ({ ...d.data(), _id: d.id }));
      renderEventList();
    });
    onSnapshot(collection(db, "transfers"), (snap) => {
      transferDocs = snap.docs.map((d) => ({ ...d.data(), _id: d.id }));
      renderEventList();
    });
    onSnapshot(query(collection(db, "changelog"), orderBy("createdAt", "desc"), limit(20)), (snap) => {
      changeLogDocs = snap.docs.map((d) => ({ ...d.data(), _id: d.id }));
      renderChangeLog(changeLogDocs);
    }, () => { $("changeLogList").innerHTML = '<div class="empty">Could not load the change log.</div>'; });
  }

  // Report a permission failure clearly (a signed-in Google account whose
  // email isn't on the allow-list in firestore.rules) instead of leaving
  // the screen stuck on "Loading…" forever.
  onSnapshot(collection(db, "staff"), () => {}, (err) => {
    if (err.code === "permission-denied") {
      $("syncDot").className = "dot off";
      $("syncText").textContent = "Your account isn't allowed to use this roster yet — ask the owner to add your email.";
    }
  });
  initSync();

  function renderChangeLog(entries) {
    const el = $("changeLogList");
    if (!entries.length) { el.innerHTML = '<div class="empty">No changes logged yet.</div>'; return; }
    el.innerHTML = "";
    entries.forEach((e) => {
      const row = document.createElement("div");
      row.className = "logentry";

      const head = document.createElement("div");
      head.style.cssText = "display:flex; justify-content:space-between; gap:8px; align-items:flex-start;";
      const req = document.createElement("div");
      req.className = "logrequest";
      req.textContent = e.request || "Roster rebuilt";
      head.appendChild(req);
      const del = document.createElement("button");
      del.className = "xbtn";
      del.textContent = "✕";
      del.title = "Remove this log entry";
      del.onclick = async () => {
        const ok = await askConfirm("Remove this log entry?");
        if (!ok) return;
        try { await deleteDoc(doc(db, "changelog", e._id)); } catch (err) { toast("Could not remove it."); }
      };
      head.appendChild(del);
      row.appendChild(head);

      const when = document.createElement("div");
      when.className = "logwhen";
      when.textContent = fmtWhen(e.createdAt) + (e.breaches ? " · " + e.breaches + " breach" + (e.breaches > 1 ? "es" : "") : "");
      row.appendChild(when);

      const impact = document.createElement("div");
      const none = !e.impact || /^no one|^nobody|^first build/i.test(e.impact);
      impact.className = "logimpact " + (none ? "none" : "some");
      impact.textContent = e.impact || "No one else’s shift changed.";
      row.appendChild(impact);

      (e.notes || []).forEach((n) => {
        const noteEl = document.createElement("div");
        noteEl.className = "lognote";
        noteEl.textContent = (n.text || "") + (n.at ? " — " + fmtDate(n.at) : "");
        row.appendChild(noteEl);
      });

      const addNote = document.createElement("button");
      addNote.className = "lognotebtn";
      addNote.textContent = "+ Note";
      addNote.onclick = () => { logNoteTarget = e._id; openForm("log-note"); };
      row.appendChild(addNote);

      el.appendChild(row);
    });
  }

  const ROLE_OPTS = [
    ["rotating", "Rotating (shares the 4 shifts)"], ["fixed", "Fixed (always one shift)"],
    ["static", "Static (own set hours)"], ["vacant", "Vacant post"], ["paired", "Paired (Jason/Shehnaz only)"],
  ];
  const FLOOR_OPTS = [["All", "All / not split yet"], ["down", "Ground floor"], ["up", "1st floor"]];
  const ROOM_OPTS = [
    ["", "Not placed yet"], ["Toddlers Room", "Toddlers Room"], ["Preschoolers Room", "Preschoolers Room"],
    ["ECEC 1", "ECEC 1"], ["ECEC 2", "ECEC 2"],
  ];

  function field(labelText, inner) { return '<div class="field"><label>' + labelText + "</label>" + inner + "</div>"; }
  function selectHTML(id, opts) {
    return '<select id="' + id + '">' + opts.map((o) => '<option value="' + o[0] + '">' + o[1] + "</option>").join("") + "</select>";
  }
  function staffOptionsHTML() {
    const real = staffDocs.filter((s) => s.role !== "blank" && s.role !== "vacant" && s.name);
    real.sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!real.length) return '<option value="">No staff yet</option>';
    return real.map((s) => '<option value="' + esc(s.name) + '">' + esc(s.name) + "</option>").join("");
  }

  let currentAction = null;
  function openForm(action) {
    currentAction = action;
    formErr.textContent = "";
    if (action === "add-staff") {
      formTitle.textContent = "Add Staff";
      formBody.innerHTML =
        field("Name", '<input id="f_name" type="text" placeholder="e.g. Priya">') +
        field("Floor", selectHTML("f_floor", FLOOR_OPTS)) +
        field("Role", selectHTML("f_role", ROLE_OPTS)) +
        field("Room (same room can't share a shift)", selectHTML("f_room", ROOM_OPTS)) +
        field("Start date", '<input id="f_start" type="date" value="' + todayISO() + '">');
    } else if (action === "transfer") {
      formTitle.textContent = "Transfer";
      formBody.innerHTML =
        field("Staff", '<select id="f_staff">' + staffOptionsHTML() + "</select>") +
        field("New floor", selectHTML("f_floor", FLOOR_OPTS)) +
        field("From (week starting)", '<input id="f_start" type="date" value="' + todayISO() + '">');
    } else if (action === "add-holiday" || action === "add-maternity") {
      const kind = action === "add-holiday" ? "Holiday" : "Maternity Leave";
      formTitle.textContent = "Add " + kind;
      formBody.innerHTML =
        field("Staff", '<select id="f_staff">' + staffOptionsHTML() + "</select>") +
        field("From", '<input id="f_start" type="date" value="' + todayISO() + '">') +
        field("To (leave blank if open-ended)", '<input id="f_end" type="date">');
    } else if (action === "log-note") {
      formTitle.textContent = "Add a note";
      formBody.innerHTML = field("Note", '<input id="f_note" type="text" placeholder="e.g. Confirmed with Deoshree">');
    }
    dialog.showModal();
  }

  document.querySelectorAll(".actionbtn").forEach((btn) => {
    btn.addEventListener("click", () => openForm(btn.dataset.action));
  });

  const PAIR = ["Jason", "Shehnaz"];
  function overlapsPartnerLeave(name, start, end) {
    if (PAIR.indexOf(name) === -1) return null;
    const partner = name === PAIR[0] ? PAIR[1] : PAIR[0];
    const partnerLeave = leaveDocs.filter((l) => l.name === partner);
    const s1 = start, e1 = end || "9999-12-31";
    for (const l of partnerLeave) {
      const s2 = l.start, e2 = l.end || "9999-12-31";
      if (s1 <= e2 && s2 <= e1) return partner;
    }
    return null;
  }

  formSave.onclick = async () => {
    formErr.textContent = "";
    formSave.disabled = true;
    try {
      if (currentAction === "add-staff") {
        const name = ($("f_name").value || "").trim();
        if (!name) { formErr.textContent = "Name is required."; formSave.disabled = false; return; }
        const floor = $("f_floor").value, role = $("f_role").value, room = $("f_room").value, start = $("f_start").value;
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || ("staff-" + Date.now());
        const order = staffDocs.reduce((m, s) => Math.max(m, s.order || 0), 0) + 1;
        await setDoc(doc(db, "staff", id), {
          name, floor, role, note: "", hours: ["", "", "", "", ""],
          number: "", order, active: true, startDate: start, room,
        });
        toast("Added " + name + ". Rebuilding…");
      } else if (currentAction === "transfer") {
        const staff = $("f_staff").value, floor2 = $("f_floor").value, start2 = $("f_start").value;
        if (!staff) { formErr.textContent = "Pick a staff member."; formSave.disabled = false; return; }
        await addDoc(collection(db, "transfers"), { name: staff, newFloor: floor2, start: start2, end: null, createdAt: todayISO() });
        toast("Transfer recorded for " + staff + ". Rebuilding…");
      } else if (currentAction === "add-holiday" || currentAction === "add-maternity") {
        const kindWord = currentAction === "add-holiday" ? "Holiday" : "Maternity Leave";
        const staff3 = $("f_staff").value, start3 = $("f_start").value, end3 = $("f_end").value || null;
        if (!staff3) { formErr.textContent = "Pick a staff member."; formSave.disabled = false; return; }
        const clash = overlapsPartnerLeave(staff3, start3, end3);
        if (clash) {
          formErr.textContent = "Policy: " + staff3 + " and " + clash + " can’t both be away at the same time — check " + clash + "’s leave first.";
          formSave.disabled = false;
          return;
        }
        await addDoc(collection(db, "leave"), { name: staff3, kind: kindWord, start: start3, end: end3, createdAt: todayISO() });
        toast(kindWord + " recorded for " + staff3 + ". Rebuilding…");
      } else if (currentAction === "log-note") {
        const noteText = ($("f_note").value || "").trim();
        if (!noteText) { formErr.textContent = "Type a note."; formSave.disabled = false; return; }
        if (!logNoteTarget) { formErr.textContent = "Lost track of which entry — reopen it and try again."; formSave.disabled = false; return; }
        const entry = changeLogDocs.find((x) => x._id === logNoteTarget);
        const notes = (entry && entry.notes) ? entry.notes.slice() : [];
        notes.push({ text: noteText, at: todayISO() });
        await updateDoc(doc(db, "changelog", logNoteTarget), { notes });
        toast("Note added.");
      }
      dialog.close();
    } catch (e) {
      formErr.textContent = "Could not save: " + (e && e.message ? e.message : "try again.");
    }
    formSave.disabled = false;
  };
}
