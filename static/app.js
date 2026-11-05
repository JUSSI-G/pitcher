const DAY_START = 6, DAY_END = 23, SPAN = DAY_END - DAY_START;
let allData    = null;
let findData   = {};
let activeDay  = null;
let searchDay  = null;
let userLat    = null;
let userLng    = null;
let weekOffset = 0;
let weekSearch = "";
let findSearch = "";
let weekDates  = [];
let mapDay     = null;
let map        = null;
let mapMarkers = [];

const PITCH_GROUPS = [
  { full: "7963", halves: ["7965", "7966"] },
  { full: "8005", halves: ["8007", "8008"] },
  { full: "4580", halves: ["4581", "4582"] },
  { full: "6176", halves: ["6443", "6444"] },
  { full: "4586", halves: ["4593", "4594"] },
  { full: "8050", halves: ["8052", "8053"] },
  { full: "4576", halves: ["4578", "4579"] },
  { full: "4537", halves: ["4538", "4539"] },
  { full: "7761", halves: ["7762", "7763"] },
  { full: "7764", halves: ["7765", "7766"] },
  { full: "7777", halves: ["7769", "7770"] },
];

const PID_GROUP = {};
for (const g of PITCH_GROUPS) {
  PID_GROUP[g.full] = { ...g, role: "full" };
  for (const h of g.halves) PID_GROUP[h] = { ...g, role: "half" };
}

function effectiveBookings(pid, dayData) {
  const own = dayData[pid] || [];
  const group = PID_GROUP[pid];
  if (!group) return own;

  if (group.role === "half") {
    const fullBookings = dayData[group.full] || [];
    return mergeBookings(own, fullBookings);
  }

  if (group.role === "full") {
    const halfBookings = group.halves.flatMap(h => dayData[h] || []);
    return mergeBookings(own, halfBookings);
  }

  return own;
}

function mergeBookings(a, b) {
  const seen = new Set(a.map(x => `${x.startHour}-${x.endHour}`));
  const extra = b.filter(x => !seen.has(`${x.startHour}-${x.endHour}`));
  return [...a, ...extra];
}

// eTimmi returns nothing at all for pitches that have no published schedule
// (typically outdoor pitches out of season). Such a pitch is unknown, not free.
function hasSchedule(pid, dayData) {
  if (dayData[pid]) return true;
  const g = PID_GROUP[pid];
  return !!g && [g.full, ...g.halves].some(id => dayData[id]);
}

function scheduledPitches(dayData) {
  return Object.keys(allData.pitches).filter(pid => hasSchedule(pid, dayData));
}

function venueCount(pids) {
  return new Set(pids.map(pid => allData.pitches[pid].building)).size;
}

function fmtDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}


const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
function esc(v) { return String(v ?? "").replace(/[&<>"']/g, c => ESC[c]); }

function localHour(ms) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki", hour: "2-digit", minute: "2-digit", hour12: false
  });
  const p = {}; fmt.formatToParts(new Date(ms)).forEach(x => p[x.type] = x.value);
  return parseInt(p.hour) + parseInt(p.minute) / 60;
}
function localDateKey(ms) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit"
  });
  const p = {}; fmt.formatToParts(new Date(ms)).forEach(x => p[x.type] = x.value);
  return `${p.year}-${p.month}-${p.day}`;
}
function fmtTime(ms) {
  return new Intl.DateTimeFormat("fi-FI", {
    timeZone: "Europe/Helsinki", hour: "2-digit", minute: "2-digit"
  }).format(new Date(ms));
}
function fmtHourMin(h) {
  const hh = Math.floor(h), mm = Math.round((h % 1) * 60);
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
}
function freeSlots(bookings) {
  const sorted = [...bookings].sort((a, b) => a.startHour - b.startHour);
  let cursor = DAY_START; const slots = [];
  for (const b of sorted) {
    if (b.startHour > cursor) slots.push({ start: cursor, end: b.startHour });
    cursor = Math.max(cursor, b.endHour);
  }
  if (DAY_END > cursor) slots.push({ start: cursor, end: DAY_END });
  return slots;
}
function freeMinutes(bookings) {
  return Math.round(freeSlots(bookings).reduce((a, s) => a + (s.end - s.start), 0) * 60);
}
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function loadData() {
  const res = await fetch(`/api/bookings?week=${weekOffset}`);
  const data = await res.json();
  if (data.error) { const e = new Error(data.error); e.noData = true; throw e; }
  allData = data;
  const fetched = allData.fetchedAt;
  const sameDay = localDateKey(fetched) === localDateKey(Date.now());
  const when = sameDay ? fmtTime(fetched) : new Intl.DateTimeFormat("fi-FI", {
    timeZone: "Europe/Helsinki", day: "numeric", month: "numeric"
  }).format(new Date(fetched)) + " " + fmtTime(fetched);
  document.getElementById("updatedAt").innerHTML =
    `Updated ${when}`;
  const byDate = {};
  for (const b of allData.bookings) {
    const dk = localDateKey(b.startMs);
    if (!byDate[dk]) byDate[dk] = {};
    if (!byDate[dk][b.pitchId]) byDate[dk][b.pitchId] = [];
    byDate[dk][b.pitchId].push({
      startHour: localHour(b.startMs), endHour: localHour(b.endMs),
      label: b.label, startMs: b.startMs, endMs: b.endMs
    });
  }
  allData._byDate = byDate;
  const dates = Object.keys(byDate).sort();
  const todayKey = localDateKey(Date.now());
  activeDay = dates.includes(todayKey) ? todayKey : dates[0];
  buildWeekView(dates);
}

async function loadFindData() {
  const todayKey = localDateKey(Date.now());
  const merged = {};

  const mergeWeek = async (offset) => {
    const res = await fetch(`/api/bookings?week=${offset}`);
    const data = await res.json();
    if (data.error) { const e = new Error(data.error); e.noData = true; throw e; }
    if (!allData) allData = data;
    for (const b of data.bookings) {
      const dk = localDateKey(b.startMs);
      if (dk < todayKey) continue;
      if (!merged[dk]) merged[dk] = {};
      if (!merged[dk][b.pitchId]) merged[dk][b.pitchId] = [];
      merged[dk][b.pitchId].push({
        startHour: localHour(b.startMs), endHour: localHour(b.endMs),
        label: b.label, startMs: b.startMs, endMs: b.endMs
      });
    }
  };

  await mergeWeek(0);
  await mergeWeek(1);

  findData = merged;
  const futureDates = Object.keys(merged).sort().slice(0, 10);
  searchDay = futureDates[0] || todayKey;
  buildFindForm(futureDates);
}

function weekLabel() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = d => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

function changeWeek(delta) {
  weekOffset += delta;
  document.getElementById("weekView").innerHTML =
    '<div class="skeleton" aria-busy="true">' + '<div class="sk-row"></div>'.repeat(5) + '</div>';
  renderWeekNav();
  loadData().catch(() => {
    document.getElementById("weekView").innerHTML =
      '<div class="loading">Failed to load — try refreshing.</div>';
  });
}

function switchTab(tab, el) {
  document.querySelectorAll(".main-tab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  document.getElementById("weekView").style.display = tab === "week" ? "" : "none";
  document.getElementById("weekNav").style.display  = tab === "week" ? "" : "none";
  document.getElementById("findView").style.display = tab === "find" ? "" : "none";
  document.getElementById("mapView").style.display  = tab === "map"  ? "" : "none";
  if (tab === "map") showMap();
}

function renderWeekNav() {
  const nav = document.getElementById("weekNav");
  const isCurrentWeek = weekOffset === 0;
  nav.innerHTML = `
    <button class="week-arrow" onclick="changeWeek(-1)" ${weekOffset <= -1 ? "disabled" : ""}>←</button>
    <div class="week-label">
      ${isCurrentWeek ? '<span class="this-week">This week</span>' : ""}
      ${weekLabel()}
    </div>
    <button class="week-arrow" onclick="changeWeek(1)" ${weekOffset >= 4 ? "disabled" : ""}>→</button>
  `;
}

function buildWeekView(dates) {
  const wv = document.getElementById("weekView");
  wv.innerHTML = `
    <div class="day-tabs" id="dayTabs"></div>
    <div class="summary" id="summary"></div>
    <div class="search-bar">
      <div class="search-wrap">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.3" y2="16.3"/></svg>
        <input class="search-input" type="text" id="weekSearchInput"
          placeholder="Search a venue — Hipposhalli, Vehka…" aria-label="Search venues"
          oninput="weekSearch = this.value.toLowerCase(); renderBoard(false)">
      </div>
    </div>
    <div class="legend">
      <span><i class="sw sw-free"></i>Free</span>
      <span><i class="sw sw-booked"></i>Booked</span>
      <span><i class="sw sw-now"></i>Now</span>
    </div>
    <div class="board">
      <div class="axis" id="axis"></div>
      <div id="board"></div>
    </div>`;
  weekSearch = "";
  weekDates = dates;
  if (!mapDay || !dates.includes(mapDay)) mapDay = activeDay;
  document.getElementById("weekNav").style.display = "";
  renderWeekNav();
  renderDayTabs(dates);
  renderWeek();
  if (map) renderMap();
}
function dayChipLabel(d) {
  const dt = new Date(d + "T12:00:00Z");
  const isToday = d === localDateKey(Date.now());
  const wd = isToday ? "Today" : dt.toLocaleDateString("en-GB", { weekday: "short" });
  const dn = dt.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" });
  return { isToday, html: `<span class="dt-wd">${wd}</span><span class="dt-dn">${dn}</span>` };
}
function renderDayTabs(dates) {
  document.getElementById("dayTabs").innerHTML = dates.map((d, i) => {
    const { isToday, html } = dayChipLabel(d);
    const cls = "day-tab rise" + (d === activeDay ? " active" : "") + (isToday ? " is-today" : "");
    return `<button class="${cls}" style="--i:${i}" onclick="setDay('${d}',this)">${html}</button>`;
  }).join("");
}
function setDay(d, el) {
  activeDay = d;
  document.querySelectorAll(".day-tab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  renderWeek();
}
function renderWeek() {
  renderSummary();
  renderAxis();
  renderBoard();
}
function renderSummary() {
  const dayData = allData._byDate[activeDay] || {};
  const ids = scheduledPitches(dayData);
  const isToday = activeDay === localDateKey(Date.now());
  const nowH = localHour(Date.now());
  let totalFreeMin = 0;
  for (const id of ids) totalFreeMin += freeMinutes(effectiveBookings(id, dayData));
  const stats = [];
  if (isToday) {
    const freeNow = ids.filter(id => {
      const bookings = effectiveBookings(id, dayData);
      return nowH >= DAY_START && nowH < DAY_END &&
        !bookings.some(b => b.startHour <= nowH && b.endHour > nowH);
    }).length;
    stats.push(`<div class="stat accent"><div class="n">${freeNow}<small>/${ids.length}</small></div><div class="l">free right now</div></div>`);
  }
  stats.push(`<div class="stat"><div class="n">${ids.length}</div><div class="l">pitches · ${venueCount(ids)} venues</div></div>`);
  stats.push(`<div class="stat"><div class="n">${Math.round(totalFreeMin / 60)}<small>h</small></div><div class="l">open time ${isToday ? "today" : "this day"}</div></div>`);
  document.getElementById("summary").innerHTML = stats
    .map((s, i) => s.replace('class="stat', `style="--i:${i}" class="rise stat`)).join("");
}
function renderAxis() {
  const el = document.getElementById("axis");
  el.innerHTML = "";
  for (let h = DAY_START; h <= DAY_END; h += 2) {
    const t = document.createElement("div");
    t.className = "tick"; t.style.left = ((h-DAY_START)/SPAN*100).toFixed(1)+"%";
    t.textContent = h + ":00"; el.appendChild(t);
  }
}
function renderBoard(animate = true) {
  const board = document.getElementById("board");
  board.innerHTML = "";
  board.classList.remove("animate");
  if (animate) { void board.offsetWidth; board.classList.add("animate"); }
  const dayData = allData._byDate[activeDay] || {};
  const isToday = activeDay === localDateKey(Date.now());
  const nowH = localHour(Date.now());
  const byBuilding = {};
  for (const [pid, info] of Object.entries(allData.pitches)) {
    if (!hasSchedule(pid, dayData)) continue;
    if (weekSearch && !(info.name + " " + info.building).toLowerCase().includes(weekSearch)) continue;
    const bookings = effectiveBookings(pid, dayData);
    if (!byBuilding[info.building]) byBuilding[info.building] = [];
    byBuilding[info.building].push({ pid, info, bookings, free: freeMinutes(bookings) });
  }
  let i = 0;
  const stagger = el => el.style.setProperty("--i", Math.min(i++, 16));
  for (const [building, pitches] of Object.entries(byBuilding)) {
    pitches.sort((a, b) => b.free - a.free);
    const aEl = document.createElement("div"); aEl.className = "area-label"; stagger(aEl);
    aEl.innerHTML = `${esc(building)}<span class="count">${pitches.length} pitch${pitches.length > 1 ? "es" : ""}</span>`;
    board.appendChild(aEl);
    for (const { pid, info, bookings, free } of pitches) {
      const fStr = free === 0 ? "fully booked" : `${fmtDuration(free)} free`;
      const slots = freeSlots(bookings);
      const row = document.createElement("div"); row.className = "pitch-row"; stagger(row);
      row.onclick = () => showPitchSchedule(pid, activeDay);
      const nc  = document.createElement("div"); nc.className = "pitch-name";
      nc.innerHTML = `<span>${esc(info.name)}</span><span class="free-label${free === 0 ? " none" : ""}">${fStr}</span>`;
      const tl = document.createElement("div");
      tl.className = "timeline" + (free === 0 ? " no-free" : "");
      if (isToday && nowH >= DAY_START && nowH <= DAY_END) {
        const nl = document.createElement("div"); nl.className = "now-line";
        nl.style.left = ((nowH-DAY_START)/SPAN*100).toFixed(2)+"%"; tl.appendChild(nl);
      }
      for (const b of bookings) {
        const l = Math.max(0, (b.startHour-DAY_START)/SPAN*100);
        const r = Math.max(0, (DAY_END-b.endHour)/SPAN*100);
        if (l >= 100 || r >= 100) continue;
        const bl = document.createElement("div"); bl.className = "booked-block";
        bl.style.left = l.toFixed(2)+"%"; bl.style.right = r.toFixed(2)+"%";
        bl.title = `${fmtTime(b.startMs)}–${fmtTime(b.endMs)}: ${b.label}`;
        bl.innerHTML = `<span class="blabel">${esc(b.label)}</span>`;
        tl.appendChild(bl);
      }
      if (slots.length > 0) {
        const tip = document.createElement("div"); tip.className = "tooltip";
        tip.textContent = "Free: " + slots.map(s=>`${fmtHourMin(s.start)}–${fmtHourMin(s.end)}`).join("  ·  ");
        tl.appendChild(tip);
      }
      row.appendChild(nc); row.appendChild(tl); board.appendChild(row);
    }
  }

  const allVenues = new Set(Object.values(allData.pitches).map(p => p.building)).size;
  const shownVenues = Object.keys(byBuilding).length;
  if (!shownVenues) {
    board.insertAdjacentHTML("beforeend", weekSearch
      ? `<div class="empty-note">No venue matching <b>“${esc(weekSearch)}”</b> has a schedule this day.</div>`
      : `<div class="empty-note">No pitch has a published schedule for this day.</div>`);
  } else if (!weekSearch && shownVenues < allVenues) {
    board.insertAdjacentHTML("beforeend",
      `<div class="board-note">${allVenues - shownVenues} other venues have no schedule for this day (usually outdoor pitches out of season).</div>`);
  }
}

function buildFindForm(dates) {
  const pd = document.getElementById("pickDays");
  pd.innerHTML = dates.map(d => {
    const { isToday, html } = dayChipLabel(d);
    const cls = "pick-day" + (d === searchDay ? " active" : "") + (isToday ? " is-today" : "");
    return `<button class="${cls}" data-date="${d}" onclick="setSearchDay('${d}',this)">${html}</button>`;
  }).join("");
  updateSlider(document.getElementById("timeSlider"));
}function setSearchDay(d, el) {
  searchDay = d;
  document.querySelectorAll(".pick-day").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
}
function onSlider(el) {
  updateSlider(el);
}
function updateSlider(el) {
  const v = parseFloat(el.value);
  const pct = ((v - 6) / 16 * 100).toFixed(1) + "%";
  el.style.setProperty("--pct", pct);
  const h = Math.floor(v), m = Math.round((v % 1) * 60);
  document.getElementById("timeDisplay").textContent =
    `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}
function toggleLocation() {
  if (userLat !== null) {
    userLat = userLng = null;
    document.getElementById("locBtn").classList.remove("active");
    document.getElementById("locStatus").textContent = "";
    return;
  }
  document.getElementById("locStatus").textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      document.getElementById("locBtn").classList.add("active");
      document.getElementById("locStatus").textContent =
        `${userLat.toFixed(4)}°N, ${userLng.toFixed(4)}°E`;
    },
    () => { document.getElementById("locStatus").textContent = "Location unavailable"; },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}
function searchNow() {
  const nowH = localHour(Date.now());
  const todayKey = localDateKey(Date.now());
  searchDay = todayKey;
  document.querySelectorAll(".pick-day").forEach(el => {
    el.classList.toggle("active", el.dataset.date === todayKey);
  });
  const slider = document.getElementById("timeSlider");
  slider.value = Math.min(22, Math.max(6, nowH));
  updateSlider(slider);
  showResults(todayKey, nowH);
}
function runSearch() {
  const h = parseFloat(document.getElementById("timeSlider").value);
  showResults(searchDay, h);
}
function showResults(dateKey, targetHour) {
  const dayData = findData[dateKey] || {};
  const resultsEl = document.getElementById("results");
  const bodyEl = document.getElementById("resultsBody");
  resultsEl.style.display = "";
  const entries = [];
  const scheduled = scheduledPitches(dayData);
  for (const pid of scheduled) {
    const info = allData.pitches[pid];
    if (findSearch && !(info.name + " " + info.building).toLowerCase().includes(findSearch)) continue;
    const bookings = effectiveBookings(pid, dayData);
    const slots = freeSlots(bookings);
    const freeNow = !bookings.some(b => b.startHour <= targetHour && b.endHour > targetHour)
      && targetHour >= DAY_START && targetHour < DAY_END;
    const surrounding = slots.filter(s => s.end > targetHour && s.start <= targetHour + 2);
    const dist = (info.lat && userLat !== null)
      ? haversine(userLat, userLng, info.lat, info.lng)
      : null;
    entries.push({ pid, info, slots, freeNow, surrounding, dist, bookings });
  }
  entries.sort((a, b) => {
    if (a.freeNow !== b.freeNow) return a.freeNow ? -1 : 1;
    if (a.dist !== null && b.dist !== null) return a.dist - b.dist;
    return freeMinutes(b.bookings) - freeMinutes(a.bookings);
  });
  const label = new Date(dateKey + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long" });
  const timeStr = fmtHourMin(targetHour);
  if (entries.length === 0) {
    bodyEl.innerHTML = `<div class="results-title">No schedules</div>
      <div class="no-results">${findSearch ? "Nothing matches that filter on this day." : "No pitch has a published schedule for this day."}</div>`;
    return;
  }
  const freeCount = entries.filter(e => e.freeNow).length;
  const visibleEntries = entries.filter(e => e.freeNow || e.surrounding.length > 0);
  const unlisted = Object.keys(allData.pitches).length - scheduled.length;
  bodyEl.innerHTML = `
    <div class="results-title"><strong>${freeCount}</strong> of ${entries.length} pitches free on ${label} at ${timeStr}
      ${unlisted ? `<small>${unlisted} pitches without a published schedule are not shown</small>` : ""}</div>
    ${visibleEntries.map((entry, i) => {
      const dist = entry.dist !== null ? `<div class="result-dist"><span class="km">${entry.dist.toFixed(1)}</span>km</div>` : "";
      const pills = entry.surrounding.map(s => {
        const covers = s.start <= targetHour && s.end > targetHour;
        return `<span class="slot-pill${covers ? " highlight" : ""}">${fmtHourMin(s.start)}–${fmtHourMin(s.end)}</span>`;
      }).join("");
      return `
        <div class="result-card${entry.freeNow ? " is-free" : ""}" style="--i:${Math.min(i, 12)}"
          onclick="showPitchSchedule('${entry.pid}', '${dateKey}')">
          ${dist}
          <div class="result-body">
            <div class="result-head">
              <span class="result-name">${esc(entry.info.name)}</span>
              ${entry.freeNow ? '<span class="badge-free">Free</span>' : ""}
            </div>
            <div class="result-building">${esc(entry.info.building)}${entry.info.address ? " · " + esc(entry.info.address) : ""}</div>
            <div class="result-slots">${pills || '<span class="no-results">No free slots around this time</span>'}</div>
          </div>
          <div class="result-chev">›</div>
        </div>`;
    }).join("") || '<div class="no-results">No pitches free around that time.</div>'}
  `;
}

/* ---------- map (Leaflet) ---------- */
function venueAvailability(dateKey) {
  const dayData = (allData._byDate || {})[dateKey] || findData[dateKey] || {};
  const isToday = dateKey === localDateKey(Date.now());
  const nowH = localHour(Date.now());
  const venues = {};
  for (const [pid, info] of Object.entries(allData.pitches)) {
    if (info.lat == null || info.lng == null) continue;
    const v = venues[info.building] || (venues[info.building] =
      { building: info.building, address: info.address, lat: info.lat, lng: info.lng, pitches: [] });
    if (!hasSchedule(pid, dayData)) {
      v.pitches.push({ pid, info, scheduled: false, free: 0, freeNow: false });
      continue;
    }
    const bookings = effectiveBookings(pid, dayData);
    const free = freeMinutes(bookings);
    const freeNow = isToday && nowH >= DAY_START && nowH < DAY_END &&
      !bookings.some(b => b.startHour <= nowH && b.endHour > nowH);
    v.pitches.push({ pid, info, scheduled: true, free, freeNow });
  }
  for (const v of Object.values(venues)) {
    const listed = v.pitches.filter(p => p.scheduled);
    v.scheduled = listed.length > 0;
    v.freeNowCount = listed.filter(p => p.freeNow).length;
    v.freeCount = listed.filter(p => p.free > 0).length;
    v.state = !v.scheduled ? "none" : v.freeNowCount ? "now" : v.freeCount ? "later" : "full";
  }
  return Object.values(venues);
}

function showMap() {
  if (!allData || !allData._byDate) return;
  if (!mapDay || !weekDates.includes(mapDay)) {
    const todayKey = localDateKey(Date.now());
    mapDay = weekDates.includes(todayKey) ? todayKey : (activeDay || weekDates[0]);
  }
  renderMapDayTabs();
  initMap();
  renderMap();
  setTimeout(() => map && map.invalidateSize(), 60);
}

function renderMapDayTabs() {
  const el = document.getElementById("mapDayTabs");
  if (!el) return;
  el.innerHTML = weekDates.map(d => {
    const { isToday, html } = dayChipLabel(d);
    const cls = "day-tab" + (d === mapDay ? " active" : "") + (isToday ? " is-today" : "");
    return `<button class="${cls}" onclick="setMapDay('${d}',this)">${html}</button>`;
  }).join("");
}

function setMapDay(d, elBtn) {
  mapDay = d;
  document.querySelectorAll("#mapDayTabs .day-tab").forEach(t => t.classList.remove("active"));
  elBtn.classList.add("active");
  renderMap();
}

function initMap() {
  if (map || typeof L === "undefined") return;
  map = L.map("map", { scrollWheelZoom: false, zoomControl: true, attributionControl: true })
    .setView([62.245, 25.74], 12);
  const esri = layer =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${layer}/MapServer/tile/{z}/{y}/{x}`;
  L.tileLayer(esri("World_Light_Gray_Base"), {
    attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 16
  }).addTo(map);
  L.tileLayer(esri("World_Light_Gray_Reference"), { maxZoom: 16, pane: "overlayPane" }).addTo(map);
  const syncZoomClass = () => map.getContainer().classList.toggle("zoomed-out", map.getZoom() < 11);
  map.on("zoomend", syncZoomClass);
  syncZoomClass();
}

const MARKER_LABEL = { now: "free now", later: "free later today", full: "fully booked", none: "no schedule" };

function renderMap() {
  if (!map) return;
  mapMarkers.forEach(m => map.removeLayer(m));
  mapMarkers = [];
  const venues = venueAvailability(mapDay);
  // scheduled venues first so they render on top of greyed-out ones
  venues.sort((a, b) => a.scheduled - b.scheduled);
  venues.forEach((v, i) => {
    const count = v.state === "now" ? v.freeNowCount : v.state === "later" ? v.freeCount : v.state === "full" ? 0 : "–";
    const icon = L.divIcon({
      className: "pitch-marker-wrap",
      html: `<div class="mk-pos"><div class="pitch-marker mk-${v.state}" style="--i:${i}">
               <span class="mk-dot"></span><span class="mk-n">${count}</span></div></div>`,
      iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -14]
    });
    const marker = L.marker([v.lat, v.lng], {
      icon, riseOnHover: true, zIndexOffset: v.scheduled ? 500 : 0,
      title: `${v.building}: ${MARKER_LABEL[v.state]}`, alt: v.building
    }).addTo(map);
    const rows = v.pitches
      .sort((a, b) => (b.scheduled - a.scheduled) || (b.free - a.free))
      .map(p => p.scheduled
        ? `<button class="pop-row${p.freeNow ? " is-free" : ""}" onclick="showPitchSchedule('${p.pid}','${mapDay}')">
             <span class="pop-name">${esc(p.info.name)}</span>
             <span class="pop-free${p.free === 0 ? " none" : ""}">${p.freeNow ? "now · " : ""}${p.free ? fmtDuration(p.free) : "full"}</span>
           </button>`
        : `<div class="pop-row unlisted">
             <span class="pop-name">${esc(p.info.name)}</span><span class="pop-free none">no schedule</span>
           </div>`)
      .join("");
    marker.bindPopup(
      `<div class="pop-head">${esc(v.building)}</div>
       ${v.address ? `<div class="pop-addr">${esc(v.address)}</div>` : ""}
       <div class="pop-list">${rows}</div>`,
      { className: "pitch-popup", maxWidth: 280 }
    );
    mapMarkers.push(marker);
  });
  // frame the venues that actually have schedules; fall back to everything
  const listed = venues.filter(v => v.scheduled);
  const frame = (listed.length >= 2 ? listed : venues).map(v => [v.lat, v.lng]);
  if (frame.length) map.fitBounds(frame, { padding: [56, 56], maxZoom: 13 });
}

function showPitchSchedule(pid, dateKey) {
  const info = allData.pitches[pid];
  const dayData = findData[dateKey] || (allData._byDate || {})[dateKey] || {};
  const bookings = effectiveBookings(pid, dayData);
  const slots = freeSlots(bookings);
  const dateLabel = new Date(dateKey + "T12:00:00Z").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long"
  });

  const timeline = [];
  let cursor = DAY_START;
  const sorted = [...bookings].sort((a, b) => a.startHour - b.startHour);
  for (const b of sorted) {
    if (b.startHour > cursor) timeline.push({ type: "free", start: cursor, end: b.startHour });
    timeline.push({ type: "booked", start: b.startHour, end: b.endHour, label: b.label });
    cursor = Math.max(cursor, b.endHour);
  }
  if (DAY_END > cursor) timeline.push({ type: "free", start: cursor, end: DAY_END });

  const slotRows = timeline.map(s => {
    const timeStr = `${fmtHourMin(s.start)} – ${fmtHourMin(s.end)}`;
    if (s.type === "free") {
      const dur = Math.round((s.end - s.start) * 60);
      const durStr = dur >= 60 ? `${Math.floor(dur/60)}h ${dur%60 ? dur%60 + "m" : ""}`.trim() : dur + "m";
      return `<div class="schedule-slot free">
        <span class="slot-time">${timeStr}</span>
        <span class="slot-label">Free · ${durStr}</span>
      </div>`;
    } else {
      return `<div class="schedule-slot booked">
        <span class="slot-time">${timeStr}</span>
        <span class="slot-label">${esc(s.label)}</span>
      </div>`;
    }
  }).join("");

  const bookedBlocks = sorted.map(b => {
    const l = Math.max(0, (b.startHour - DAY_START) / SPAN * 100);
    const r = Math.max(0, (DAY_END - b.endHour) / SPAN * 100);
    return `<div class="booked-block" style="left:${l.toFixed(2)}%;right:${r.toFixed(2)}%"></div>`;
  }).join("");

  const isToday = dateKey === localDateKey(Date.now());
  const nowH = localHour(Date.now());
  const nowLine = isToday && nowH >= DAY_START && nowH <= DAY_END
    ? `<div class="now-line" style="left:${((nowH - DAY_START) / SPAN * 100).toFixed(2)}%"></div>` : "";

  const totalFree = freeMinutes(bookings);
  const freeStr = totalFree === 0 ? "Fully booked" : `${fmtDuration(totalFree)} free`;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div>
          <div class="modal-title">${esc(info.name)}</div>
          <div class="modal-subtitle">${esc(info.building)}${info.address ? " · " + esc(info.address) : ""}</div>
        </div>
        <button class="modal-close" onclick="closeModal(this.closest('.modal-overlay'))" aria-label="Close">&times;</button>
      </div>
      <div class="modal-date">${dateLabel}<span class="free-total">${freeStr}</span></div>
      <div class="modal-timeline">${bookedBlocks}${nowLine}</div>
      <div class="schedule-list">${slotRows}</div>
    </div>`;

  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(overlay); });
  const onKey = e => { if (e.key === "Escape") closeModal(overlay); };
  overlay._onKey = onKey;
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
}

function closeModal(overlay) {
  if (overlay._onKey) document.removeEventListener("keydown", overlay._onKey);
  overlay.remove();
}

loadData().catch(err => {
  document.getElementById("weekView").innerHTML =
    `<div class="loading">${err.noData ? "Data not loaded. Update locally!" : "Failed to load — try refreshing."}</div>`;
});
loadFindData().catch(err => {
  document.getElementById("pickDays").innerHTML =
    `<span class="loc-status">${err.noData ? "Data not loaded." : "Could not load dates — try refreshing."}</span>`;
});