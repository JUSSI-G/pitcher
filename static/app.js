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
  allData = await res.json();
  document.getElementById("updatedAt").textContent =
    "Updated " + new Date(allData.fetchedAt).toLocaleTimeString("fi-FI", {
      timeZone: "Europe/Helsinki", hour: "2-digit", minute: "2-digit"
    });
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
  activeDay = dates[0];
  buildWeekView(dates);
}

async function loadFindData() {
  const todayKey = localDateKey(Date.now());
  const merged = {};

  const mergeWeek = async (offset) => {
    const res = await fetch(`/api/bookings?week=${offset}`);
    const data = await res.json();
    if (!allData) allData = data;  // use as pitches reference if not set yet
    for (const b of data.bookings) {
      const dk = localDateKey(b.startMs);
      if (dk < todayKey) continue;  // skip past days
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
  monday.setDate(now.getDate() - now.getDay() + 1 + weekOffset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = d => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

function changeWeek(delta) {
  weekOffset += delta;
  document.getElementById("weekView").innerHTML =
    '<div class="loading"><div class="spinner"></div> Loading…</div>';
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
      <input class="search-input" type="text" id="weekSearchInput"
        placeholder="Vaajakoski, Hipposhalli…"
        oninput="weekSearch = this.value.toLowerCase(); renderBoard()">
    </div>
    <div class="legend">
      <span><i class="swatch" style="background:var(--free)"></i>Free</span>
      <span><i class="swatch" style="background:var(--booked)"></i>Booked</span>
      <span><i class="swatch" style="background:var(--gold)"></i>Now</span>
    </div>
    <div class="board">
      <div class="axis" id="axis"></div>
      <div id="board"></div>
    </div>`;
  weekSearch = "";
  document.getElementById("weekNav").style.display = "";
  renderWeekNav();
  renderDayTabs(dates);
  renderWeek();
}
function renderDayTabs(dates) {
  document.getElementById("dayTabs").innerHTML = dates.map(d => {
    const label = new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", {
      weekday: "short", day: "2-digit", month: "2-digit"
    });
    return `<button class="day-tab${d === activeDay ? " active" : ""}" onclick="setDay('${d}',this)">${label}</button>`;
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
  const ids = Object.keys(dayData);
  const isToday = activeDay === localDateKey(Date.now());
  const nowH = localHour(Date.now());
  let html = "";
  if (isToday) {
    const freeNow = ids.filter(id =>
      nowH >= DAY_START && nowH < DAY_END &&
      !dayData[id].some(b => b.startHour <= nowH && b.endHour > nowH)
    ).length;
    html = `<div class="stat"><div class="n">${freeNow}/${ids.length}</div><div class="l">free right now</div></div>`;
  }
  document.getElementById("summary").innerHTML = html;
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
function renderBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";
  const dayData = allData._byDate[activeDay] || {};
  const isToday = activeDay === localDateKey(Date.now());
  const nowH = localHour(Date.now());
  const byBuilding = {};
  for (const [pid, info] of Object.entries(allData.pitches)) {
    if (!dayData[pid]) continue;
    if (weekSearch && !(info.name + " " + info.building).toLowerCase().includes(weekSearch)) continue;
    if (!byBuilding[info.building]) byBuilding[info.building] = [];
    byBuilding[info.building].push({ pid, info, bookings: dayData[pid], free: freeMinutes(dayData[pid]) });
  }
  for (const [building, pitches] of Object.entries(byBuilding)) {
    pitches.sort((a, b) => b.free - a.free);
    const aEl = document.createElement("div"); aEl.className = "area-label";
    aEl.textContent = building; board.appendChild(aEl);
    for (const { pid, info, bookings, free } of pitches) {
      const fH = Math.floor(free/60), fM = free%60;
      const fStr = free === 0 ? "fully booked" : fH > 0 ? `${fH}h ${fM}m free` : `${fM}m free`;
      const slots = freeSlots(bookings);
      const row = document.createElement("div"); row.className = "pitch-row";
      const nc  = document.createElement("div"); nc.className = "pitch-name";
      nc.innerHTML = `<span>${info.name}</span>`;
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
        bl.innerHTML = `<span class="blabel">${b.label}</span>`;
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
}

function buildFindForm(dates) {
  const pd = document.getElementById("pickDays");
  pd.innerHTML = dates.map(d => {
    const label = new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", {
      weekday: "short", day: "2-digit", month: "2-digit"
    });
    return `<button class="pick-day${d === searchDay ? " active" : ""}" data-date="${d}" onclick="setSearchDay('${d}',this)">${label}</button>`;
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
      document.getElementById("locStatus").textContent = "Location found ✓";
    },
    () => { document.getElementById("locStatus").textContent = "Location unavailable"; }
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
  for (const [pid, info] of Object.entries(allData.pitches)) {
    if (findSearch && !(info.name + " " + info.building).toLowerCase().includes(findSearch)) continue;
    const bookings = dayData[pid] || [];
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
    bodyEl.innerHTML = `<div class="results-title">Results</div><div class="no-results">No data for this day.</div>`;
    return;
  }
  const freeCount = entries.filter(e => e.freeNow).length;
  const visibleEntries = entries.filter(e => e.freeNow || e.surrounding.length > 0);
  bodyEl.innerHTML = `
    <div class="results-title">${freeCount} pitches free on ${label} at ${timeStr}</div>
    ${visibleEntries.map(entry => {
      const dist = entry.dist !== null ? `<div class="result-dist"><span class="km">${entry.dist.toFixed(1)}</span>km</div>` : "";
      const pills = entry.surrounding.map(s => {
        const covers = s.start <= targetHour && s.end > targetHour;
        return `<span class="slot-pill${covers ? " highlight" : ""}">${fmtHourMin(s.start)}–${fmtHourMin(s.end)}</span>`;
      }).join("");
      return `
        <div class="result-card${entry.freeNow ? " is-free" : ""}">
          ${dist}
          <div class="result-body">
            <div class="result-name">${entry.info.name}</div>
            <div class="result-building">${entry.info.building}${entry.info.address ? " · " + entry.info.address : ""}</div>
            <div class="result-slots">${pills || '<span class="no-results">No free slots around this time</span>'}</div>
          </div>
        </div>`;
    }).join("") || '<div class="no-results">No pitches free around that time.</div>'}
  `;
}
loadData().catch(() => {
  document.getElementById("weekView").innerHTML =
    '<div class="loading">Failed to load — try refreshing.</div>';
});
loadFindData().catch(() => {
  document.getElementById("pickDays").innerHTML =
    '<span style="color:var(--muted-2);font-size:12px;">Could not load dates — try refreshing.</span>';
});