/* 올팍 공연일 알림 · 정적 사이트 (v3, 공원 안내판·시간표). 데이터: data/*.json (build/build_data.py, build/update_schedule.py) */
(function () {
  "use strict";

  // 시설별 가까운 주차장: 올림픽공원 누리집 「주차 안내」 목적지별 주차장 표
  var FAC = [
    { id: "pool", name: "올림픽수영장", lot: ["P4"] },
    { id: "sports", name: "올림픽스포츠센터 (KSPO DOME)", lot: ["P5"] },
    { id: "tennis", name: "올림픽테니스장", lot: ["P11"] },
    { id: "hall", name: "올림픽홀 주변", lot: ["P2"] },
    { id: "woori", name: "우리금융아트홀 주변", lot: ["P7"] },
    { id: "arena", name: "티켓링크 라이브 아레나 주변", lot: ["P6"] },
    { id: "kart", name: "K-아트홀 주변", lot: ["P1A", "P1B"] },
    { id: "walk", name: "산책·피크닉 (공원 전체)", lot: [] }
  ];
  var DOW = ["일", "월", "화", "수", "목", "금", "토"];
  var SHORT = { KSPO: "KSPO DOME", ARENA: "핸드볼경기장", LAWN: "88잔디마당", HALL: "올림픽홀", SMALL: "소규모·장기 공연" };
  var CELL = { KSPO: "KSPO", ARENA: "핸드볼", LAWN: "88잔디", HALL: "올림픽홀", SMALL: "기타" }; // 달력 칸용 짧은 이름(기타 = 주차 영향 분석 제외)
  var PARKING_URL = "https://www.ksponco.or.kr/online/main/parking.do";
  var SCHED_URL = "https://www.ksponco.or.kr/olympicpark/eventInfo/eventInfoList?mid=a20301010100";
  var DEFAULT = { facility: "pool", days: [2, 4, 6], from: "19:00", to: "21:00", mode: "car" };
  var KEY = "olpark-prefs-v1", THEME_KEY = "olpark-theme";
  var BAR0 = 6 * 60, BAR1 = 24 * 60; // 막대 범위 6~24시

  var D = {};
  var Q = new URLSearchParams(location.search); // 공유 링크: ?fac=pool&days=2,4&from=19:00&to=21:00&mode=car&date=2026-12-19
  var S = { prefs: load(), y: 0, m: 0, sel: null, fromLink: false };
  (function applyQuery() {
    var p = S.prefs, hit = false;
    if (Q.get("fac") && FAC.some(function (f) { return f.id === Q.get("fac"); })) { p.facility = Q.get("fac"); hit = true; }
    if (Q.get("days")) { p.days = Q.get("days").split(",").map(Number).filter(function (d) { return d >= 0 && d <= 6; }); hit = true; }
    if (/^\d\d:\d\d$/.test(Q.get("from") || "")) { p.from = Q.get("from"); hit = true; }
    if (/^\d\d:\d\d$/.test(Q.get("to") || "")) { p.to = Q.get("to"); hit = true; }
    if (Q.get("mode") === "car" || Q.get("mode") === "transit") { p.mode = Q.get("mode"); hit = true; }
    S.fromLink = hit;
    if (Q.get("fig")) document.documentElement.setAttribute("data-fig", Q.get("fig"));
  })();

  // ------------------------------------------------------------ 유틸
  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || "null");
      if (v && v.facility && Array.isArray(v.days)) return v;
    } catch (e) { /* 저장소를 쓸 수 없으면 기본값 */ }
    return JSON.parse(JSON.stringify(DEFAULT));
  }
  function save() {
    if (Q.get("fig")) return;
    try { localStorage.setItem(KEY, JSON.stringify(S.prefs)); } catch (e) { /* 무시 */ }
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === "class") n.className = attrs[k]; else n.setAttribute(k, attrs[k]); }
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
  function parseIso(s) { var p = s.split("-"); return { y: +p[0], m: +p[1] - 1, d: +p[2] }; }
  function dow(s) { var p = parseIso(s); return new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay(); }
  function mins(t) { var p = t.split(":"); return (+p[0]) * 60 + (+p[1]); }
  function hm(x) { return pad(Math.floor(x / 60)) + ":" + pad(x % 60); }
  function todayKST() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  function addDays(s, n) { var p = parseIso(s); var d = new Date(Date.UTC(p.y, p.m, p.d + n)); return iso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
  function fac() { return FAC.filter(function (f) { return f.id === S.prefs.facility; })[0] || FAC[0]; }
  function pct(x) { return Math.round(x * 100) + "%"; }
  function wa(s) {
    var t = String(s).replace(/\s*\([^)]*\)\s*$/, ""), c = t.charCodeAt(t.length - 1);
    var jong = (c >= 0xAC00 && c <= 0xD7A3) ? (c - 0xAC00) % 28 : 0;
    return s + (jong ? "과" : "와");
  }
  function x100(t) { return Math.max(0, Math.min(100, (t - BAR0) / (BAR1 - BAR0) * 100)); }
  function seg(cls, a, b) { return "<i class='" + cls + "' style='left:" + x100(a).toFixed(2) + "%;width:" + (x100(b) - x100(a)).toFixed(2) + "%'></i>"; }

  // ------------------------------------------------------------ 날짜 판정
  function eventsOn(s) { return D.byDate[s] || []; }
  function isWeekend(s) { var w = dow(s); return w === 0 || w === 6 || D.holidays.indexOf(s) >= 0; }
  function typeKey(s) { return isWeekend(s) ? "weekend" : "weekday"; }
  function typeName(s) { return isWeekend(s) ? (dow(s) === 0 || dow(s) === 6 ? "주말" : "공휴일") : "평일"; }
  function typeLabel(s) { return isWeekend(s) ? "주말·공휴일" : "평일"; }
  // 그날 공연장 중 같은 요일유형의 2025년 최고 배율이 가장 큰 곳
  function dayCls(s) {
    var evs = eventsOn(s);
    if (!evs.length) return null;
    var best = null, bestR = -1, k = typeKey(s);
    evs.forEach(function (e) {
      if (e.cls === "SMALL") return;
      var st = D.model[e.cls] && D.model[e.cls][k], r = st && st.peak_r ? st.peak_r : 0;
      if (r > bestR) { bestR = r; best = e.cls; }
    });
    return best || "SMALL";
  }
  function bigCount(s) { return eventsOn(s).filter(function (e) { return e.cls !== "SMALL"; }).length; }
  function stat(s) { var c = dayCls(s); return c && D.model[c] ? D.model[c][typeKey(s)] || null : null; }
  function win(s) { var st = stat(s); return st && st.from ? st : null; }
  function mineOn(s) { return S.prefs.days.indexOf(dow(s)) >= 0; }
  function overlapRange(s) {
    var w = win(s), p = S.prefs;
    if (!w || !mineOn(s)) return null;
    var a = Math.max(mins(p.from), mins(w.from)), b = Math.min(mins(p.to), mins(w.to));
    return a < b ? [a, b] : null;
  }
  function overlap(s) { return !!overlapRange(s); }
  // 내 이용 시간 안에서 2025년 같은 유형 공연일의 가장 높은 시간대 배율
  function myPeak(s) {
    var st = stat(s), pf = mins(S.prefs.from) / 60, pt = mins(S.prefs.to) / 60, best = null;
    if (!st || !mineOn(s)) return null;
    for (var h = 6; h < 24; h++) {
      var v = st.ratio[h];
      if (v != null && h + 1 > pf && h < pt && (!best || v > best.r)) best = { h: h, r: v };
    }
    return best;
  }

  // ------------------------------------------------------------ 설정 폼
  function buildForm() {
    var sel = $("facility");
    FAC.forEach(function (f) { sel.appendChild(el("option", { value: f.id }, esc(f.name))); });
    var days = $("days");
    [1, 2, 3, 4, 5, 6, 0].forEach(function (d) {
      var lb = el("label");
      lb.appendChild(el("input", { type: "checkbox", value: String(d), "aria-label": DOW[d] + "요일" }));
      lb.appendChild(el("span", { "aria-hidden": "true" }, DOW[d]));
      days.appendChild(lb);
    });
    var times = [];
    for (var h = 6; h <= 23; h++) { times.push(pad(h) + ":00"); if (h < 23) times.push(pad(h) + ":30"); }
    ["tFrom", "tTo"].forEach(function (id) { times.forEach(function (t) { $(id).appendChild(el("option", { value: t }, t)); }); });
    syncForm();
    $("prefs").addEventListener("change", readForm);
  }
  function syncForm() {
    var p = S.prefs;
    $("facility").value = p.facility;
    Array.prototype.forEach.call($("days").querySelectorAll("input"), function (cb) { cb.checked = p.days.indexOf(+cb.value) >= 0; });
    $("tFrom").value = p.from; $("tTo").value = p.to;
    Array.prototype.forEach.call(document.querySelectorAll("input[name=mode]"), function (r) { r.checked = r.value === p.mode; });
  }
  function readForm() {
    var p = S.prefs;
    p.facility = $("facility").value;
    p.days = Array.prototype.filter.call($("days").querySelectorAll("input"), function (cb) { return cb.checked; }).map(function (cb) { return +cb.value; });
    p.from = $("tFrom").value; p.to = $("tTo").value;
    if (mins(p.to) <= mins(p.from)) { var i = Math.min($("tFrom").selectedIndex + 2, $("tTo").options.length - 1); p.to = $("tTo").options[i].value; $("tTo").value = p.to; }
    var m = document.querySelector("input[name=mode]:checked"); p.mode = m ? m.value : "car";
    save(); render();
  }
  function shareLink() {
    var p = S.prefs, u = new URL(location.href.split("?")[0].split("#")[0]);
    u.searchParams.set("fac", p.facility); u.searchParams.set("days", p.days.join(","));
    u.searchParams.set("from", p.from); u.searchParams.set("to", p.to); u.searchParams.set("mode", p.mode);
    return u.href;
  }

  // ------------------------------------------------------------ 화면 밝기
  function themeInit() {
    var b = $("theme"), order = ["auto", "light", "dark"], name = { auto: "자동", light: "밝게", dark: "어둡게" };
    function cur() { return document.documentElement.getAttribute("data-theme") || "auto"; }
    function paint() { var c = cur(); b.textContent = "화면 " + name[c]; b.setAttribute("aria-label", "화면 밝기: " + name[c] + ". 눌러서 바꾸기"); }
    b.addEventListener("click", function () {
      var n = order[(order.indexOf(cur()) + 1) % order.length];
      if (n === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", n);
      try { if (n === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, n); } catch (e) { /* 무시 */ }
      paint();
    });
    paint();
  }

  // ------------------------------------------------------------ 요약·달력
  function renderSummary() {
    var p = S.prefs, f = fac();
    var dayTxt = p.days.length ? [1, 2, 3, 4, 5, 6, 0].filter(function (d) { return p.days.indexOf(d) >= 0; }).map(function (d) { return DOW[d]; }).join("·") : "요일을 고르세요";
    var txt = "<b>" + esc(f.name) + "</b>, " + dayTxt + " <span class='num'>" + p.from + "~" + p.to + "</span>, " + (p.mode === "car" ? "자가용" : "대중교통·도보");
    if (p.mode !== "car") txt += ". 대중교통 이용이라 주차 영향은 없지만, 공연일 겹침을 참고로 표시합니다.";
    $("mySummary").innerHTML = txt;
  }
  function bars(s) {
    var w = win(s), o = overlapRange(s), h = "";
    if (w) h += seg("w", mins(w.from), mins(w.to));
    if (mineOn(s)) h += seg("m", mins(S.prefs.from), mins(S.prefs.to));
    if (o) h += seg("x", o[0], o[1]);
    return h;
  }
  function renderCal() {
    var y = S.y, m = S.m, cal = $("cal");
    $("monthLabel").textContent = y + "년 " + (m + 1) + "월";
    cal.innerHTML = "";
    [1, 2, 3, 4, 5, 6, 0].forEach(function (i) { cal.appendChild(el("div", { class: "dow", role: "columnheader" }, DOW[i])); });
    var first = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7, last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (var i = 0; i < first; i++) cal.appendChild(el("div", { class: "pad", "aria-hidden": "true" }));
    var today = todayKST(), nEv = 0, nHit = 0, nMine = 0;
    for (var d = 1; d <= last; d++) {
      var s = iso(y, m, d), evs = eventsOn(s), c = dayCls(s), w = win(s), hit = evs.length && overlap(s);
      if (w) nEv++;
      if (hit) nHit++;
      if (mineOn(s)) nMine++;
      var cls = "day" + (hit ? " hit" : "") + (s === today ? " today" : "") + (s === S.sel ? " sel" : "") + (D.holidays.indexOf(s) >= 0 ? " hol" : "");
      var more = bigCount(s) > 1 ? bigCount(s) - 1 : 0;
      var label = (m + 1) + "월 " + d + "일 " + DOW[dow(s)] + "요일" + (evs.length ? ", " + SHORT[c] + (more ? " 외 " + more + "곳" : "") + " 공연" : "") +
        (w ? ", 주차 증가 " + w.from + "~" + w.to : "") + (hit ? ", 내 시간과 겹침" : "");
      var b = el("button", { type: "button", class: cls, "data-d": s, "aria-label": label, "aria-pressed": s === S.sel ? "true" : "false" });
      var inner = "<span><span class='n'>" + d + "</span>" + (hit ? "<span class='hitw' aria-hidden='true'>겹침</span>" : "");
      if (evs.length) inner += "<br><span class='venue" + (w ? "" : " weak") + "'>" + esc(CELL[c]) + (more ? " +" + more : "") + "</span>";
      inner += "</span>";
      if (w || mineOn(s)) inner += "<span class='bar' aria-hidden='true'>" + bars(s) + "</span>";
      b.innerHTML = inner;
      b.addEventListener("click", onDay);
      cal.appendChild(b);
    }
    var t;
    if (!D.events.length) t = "공연 일정을 아직 불러오지 못했습니다.";
    else if (!nMine) t = "요일을 고르면 내 이용일 중 공연과 겹치는 날을 셉니다. 이 달 주차가 늘어나는 공연일은 <b class='num'>" + nEv + "일</b>입니다.";
    else if (!nHit) t = "이 달 내 이용일 <b class='num'>" + nMine + "일</b>은 공연으로 붐비는 시간과 겹치지 않습니다.";
    else t = "이 달 내 이용일 <b class='num'>" + nMine + "일</b> 중 <b class='num hitn'>" + nHit + "일</b>이 공연으로 붐비는 시간과 겹칩니다.";
    $("monthSum").innerHTML = t;
  }
  function onDay(e) {
    S.sel = e.currentTarget.getAttribute("data-d"); renderCal(); renderDay();
    if (window.matchMedia("(max-width: 960px)").matches) $("detail").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ------------------------------------------------------------ 날짜 상세
  function lawnTip(s) {
    var mdx = s.slice(5), closed = mdx >= "11-01" || mdx <= "05-31";
    return (closed ? "정기 잔디 출입 통제 기간(11월~이듬해 5월)입니다. 88마당·지구촌공원·전시마당 잔디는 이용할 수 없고, 나홀로나무·피크닉장·가족놀이동산은 연중 개방입니다."
                   : "88마당·지구촌공원·전시마당 정기 잔디 개방 기간(6~10월)입니다.") + " 그날의 임시 통제는 기관 공지를 확인하세요.";
  }
  function timeline(s) {
    var w = win(s), o = overlapRange(s), p = S.prefs;
    var ax = [6, 9, 12, 15, 18, 21, 24].map(function (t) { return "<span style='left:" + x100(t * 60) + "%'>" + t + "시</span>"; }).join("");
    var lg = [];
    if (w) lg.push("주차 증가 <b class='num'>" + w.from + "~" + w.to + "</b>");
    if (mineOn(s)) lg.push("내 시간 <b class='num'>" + p.from + "~" + p.to + "</b>");
    if (o) lg.push("겹침 <b class='num'>" + hm(o[0]) + "~" + hm(o[1]) + "</b>");
    return "<div class='tl' role='img' aria-label='" + esc(lg.join(", ").replace(/<[^>]+>/g, "")) + "'><div class='tl-track'>" + bars(s) + "</div><div class='tl-axis' aria-hidden='true'>" + ax + "</div>" +
      (lg.length ? "<p class='tl-legend'>" + lg.join(" · ") + "</p>" : "") + "</div>";
  }
  // 시간대별 막대(6~23시): 막대가 높을수록 평소보다 차가 많다. 회색=평소 수준, 초록=붐빔(기준 이상), 주홍=붐빔+내 시간
  function chart(s) {
    var st = stat(s);
    if (!st) return "";
    var thr = st.threshold || 1.3, r = st.ratio, H0 = 6, H1 = 24, n = H1 - H0;
    var W = 640, H = 250, L = 52, R = 10, T = 34, B = 38, iw = W - L - R, ih = H - T - B;
    var vals = r.slice(H0, H1).filter(function (v) { return v != null; });
    var ymax = Math.max(2, Math.ceil(Math.max.apply(null, vals) + 0.15));
    function Y(v) { return T + ih * (1 - v / ymax); }
    var bw = iw / n, mine = mineOn(s), pf = mins(S.prefs.from) / 60, pt = mins(S.prefs.to) / 60;
    var svg = "<svg class='chart' viewBox='0 0 " + W + " " + H + "' role='img' aria-label='시간대별로 평소보다 주차가 몇 배인지 보여 주는 막대그래프. 가장 붐비는 때는 " + st.peak_h + "시, 평소의 약 " + st.peak_r.toFixed(1) + "배'>";
    for (var k = 1; k <= ymax; k++) {
      svg += "<line class='" + (k === 1 ? "base" : "grid") + "' x1='" + L + "' x2='" + (W - R) + "' y1='" + Y(k).toFixed(1) + "' y2='" + Y(k).toFixed(1) + "'/>";
      svg += "<text x='" + (L - 8) + "' y='" + (Y(k) + 4).toFixed(1) + "' text-anchor='end'>" + (k === 1 ? "평소" : k + "배") + "</text>";
    }
    for (var h = H0; h < H1; h++) {
      var v = r[h];
      if (v == null) continue;
      var x = L + (h - H0) * bw + bw * 0.15, wd = bw * 0.7, y = Y(v), inMine = mine && h + 1 > pf && h < pt;
      var cls = v >= thr ? (inMine ? "b-hit" : "b-busy") : "b-calm";
      svg += "<rect class='" + cls + "' x='" + x.toFixed(1) + "' y='" + y.toFixed(1) + "' width='" + wd.toFixed(1) + "' height='" + (Y(0) - y).toFixed(1) + "' rx='2'><title>" + h + "시대: 평소의 " + v.toFixed(1) + "배</title></rect>";
      if (h === st.peak_h) svg += "<text class='peak' x='" + (x + wd / 2).toFixed(1) + "' y='" + (y - 8).toFixed(1) + "' text-anchor='middle'>" + h + "시 약 " + v.toFixed(1) + "배</text>";
    }
    if (mine) {
      var x0 = L + (Math.max(pf, H0) - H0) * bw, x1 = L + (Math.min(pt, H1) - H0) * bw, yb = Y(0) + 5;
      svg += "<path class='mine' d='M" + x0.toFixed(1) + " " + yb + "v6H" + x1.toFixed(1) + "v-6'/>";
    }
    for (var hh = H0; hh <= H1; hh += 3) svg += "<text x='" + (L + (hh - H0) * bw).toFixed(1) + "' y='" + (H - 4) + "' text-anchor='" + (hh === H0 ? "start" : hh === H1 ? "end" : "middle") + "'>" + hh + "시</text>";
    svg += "</svg>";
    return svg + "<ul class='chart-key'><li><span class='key k-calm'></span>평소와 비슷</li><li><span class='key k-busy'></span>평소보다 붐빔(" + thr + "배 이상)</li>" +
      (mine ? "<li><span class='key k-hit'></span>붐비는데 내 이용 시간</li><li><span class='key k-mine'></span>내 이용 시간</li>" : "") + "</ul>";
  }
  // 그래프 위 한 줄 요약(내 시간 먼저) + 그래프 + 근거
  function story(s) {
    var st = stat(s), c = dayCls(s), w = win(s), mp = myPeak(s), p = S.prefs;
    if (!st) return "";
    var thr = st.threshold || 1.3, start = w ? Number(w.from.slice(0, 2)) + "시쯤부터 늘기 시작해 " : "";
    var whole = start + st.peak_h + "시에 평소보다 가장 많이 늘었습니다(약 " + st.peak_r.toFixed(1) + "배).";
    var head;
    if (mp && mp.h === st.peak_h) head = "비슷한 공연일에는 내 시간 " + p.from + "~" + p.to + "에 든 " + st.peak_h + "시에 주차가 평소보다 가장 많이 늘었습니다(약 " + st.peak_r.toFixed(1) + "배)." + (w ? " 차는 " + Number(w.from.slice(0, 2)) + "시쯤부터 늘기 시작합니다." : "");
    else if (mp) head = "비슷한 공연일, 내 시간 " + p.from + "~" + p.to + " 주차는 " + (mp.r >= thr ? "가장 붐빌 때 평소의 약 " + mp.r.toFixed(1) + "배였습니다. " : "평소와 비슷했습니다(가장 높을 때 약 " + mp.r.toFixed(1) + "배). ") + "하루 중에는 " + whole;
    else head = "비슷한 공연일에는 주차가 " + whole;
    var src = "2025년 " + esc(SHORT[c]) + " " + typeLabel(s) + " 공연일 " + st.days + "일 중 " + Math.round(st.share_up * st.days) + "일은 12~22시 중 한 시각 이상 주차가 평소의 " + thr + "배 이상이었습니다" + (st.days < 10 ? "(표본이 적어 참고용)" : "") + ". " +
      "막대 하나는 한 시간대이고, 공연이 없는 같은 요일유형 날의 같은 시각과 비교한 배율입니다. 공원 전체(동2·남2·북2문) 기준이라 실제 공연 시각이나 같은 날 다른 행사에 따라 달라질 수 있습니다.";
    return "<h3 class='sub-h'>" + (mp ? "내 시간에 얼마나 붐빌까" : "시간대별 주차") + "</h3><p class='story'>" + head + "</p>" + chart(s) + "<p class='chart-note'>" + src + "</p>";
  }
  // 이날 공연: 시각 | 공연명·공연장·기간·예매. 큰 공연장 먼저, 소규모·장기 공연은 아래에 흐리게
  function eventList(s) {
    var k = typeKey(s);
    function rank(e) { var st = D.model[e.cls] && D.model[e.cls][k]; return e.cls === "SMALL" ? -1 : (st && st.peak_r) || 0; }
    var evs = eventsOn(s).slice().sort(function (a, b) { return rank(b) - rank(a) || (a.time || "99").localeCompare(b.time || "99"); });
    function row(e) {
      var times = e.time ? e.time.split("·") : [];
      var meta = ["<span class='vtag'>" + esc(e.venue.replace(/^올림픽공원\s*/, "")) + "</span>"];
      if (e.begin !== e.end) meta.push(e.begin.slice(5).replace("-", "/") + "~" + e.end.slice(5).replace("-", "/") + " 공연");
      if (e.url) meta.push("<a href='" + esc(e.url) + "' rel='noopener' target='_blank'>예매</a>");
      return "<li class='ev" + (e.cls === "SMALL" ? " small" : "") + "'><div class='ev-time'>" +
        (times.length ? times.map(function (t) { return "<span class='num'>" + t + "</span>"; }).join("") : "<span class='tbd'>시간 미정</span>") +
        "</div><div class='ev-body'><p class='ev-title'>" + esc(e.title) + "</p><p class='ev-meta'>" + meta.join(" · ") + "</p>" +
        (!times.length && e.tm ? "<p class='ev-raw'>" + esc(e.tm) + "</p>" : "") + "</div></li>";
    }
    var big = evs.filter(function (e) { return e.cls !== "SMALL"; }), small = evs.filter(function (e) { return e.cls === "SMALL"; });
    var h = "<h3 class='sub-h'>이날 공연</h3>";
    if (big.length) h += "<ol class='evs'>" + big.map(row).join("") + "</ol>";
    if (small.length) h += "<p class='small-h'>소규모·장기 공연 (주차 영향 분석 제외)</p><ol class='evs small-list'>" + small.map(row).join("") + "</ol>";
    return h;
  }
  function renderDay() {
    var s = S.sel; if (!s) return;
    var evs = eventsOn(s), p = parseIso(s), f = fac(), w = win(s), ov = overlap(s), o = overlapRange(s), mp = myPeak(s), my = S.prefs.from + "~" + S.prefs.to;
    $("dayTitle").textContent = (p.m + 1) + "월 " + p.d + "일 " + DOW[dow(s)] + "요일" + (D.holidays.indexOf(s) >= 0 ? ", 공휴일" : "");
    var h = "";
    if (!evs.length) h += "<p class='verdict calm'>" + (mineOn(s) ? "내 이용일입니다. 현재 기관 일정에 등록된 공연이 없습니다." : "기관 일정에 등록된 공연이 없는 날입니다.") + "</p>";
    else if (ov && S.prefs.mode === "car") {
      var whole = o[0] === mins(S.prefs.from) && o[1] === mins(S.prefs.to);
      h += "<p class='verdict hit'>내 시간 " + my + (whole ? " 전체가" : " 중 " + hm(o[0]) + "~" + hm(o[1]) + "이") + " 비슷한 공연일에 주차가 늘었던 시간대와 겹칩니다" + (mp ? "(가장 붐빌 때 평소의 약 " + mp.r.toFixed(1) + "배)" : "") + ".</p>";
      h += "<p class='todo'>이날은 대중교통을 이용하거나 이용 시간을 옮기는 편이 좋습니다.</p>";
    }
    else if (ov) h += "<p class='verdict hit'>내 시간 " + my + "이 비슷한 공연일에 주차가 늘었던 시간대와 겹칩니다. 대중교통 이용이라 주차 영향은 없고, 공연이 있는 날임을 알려 드립니다.</p>";
    else if (!w) h += "<p class='verdict calm'>주차 영향 분석에서 제외한 소규모·장기 공연만 있는 날입니다.</p>";
    else if (mineOn(s)) h += "<p class='verdict'>공연일이지만 내 시간 " + my + "은 비슷한 공연일에 주차가 늘었던 시간대(" + w.from + "~" + w.to + ")를 벗어납니다.</p>";
    else h += "<p class='verdict'>공연일입니다. 내가 이용하는 요일은 아닙니다.</p>";
    var bigCls = [], tk = typeKey(s);
    evs.forEach(function (e) { if (e.cls !== "SMALL" && bigCls.indexOf(e.cls) < 0) bigCls.push(e.cls); });
    bigCls.sort(function (a, b) { var ra = (D.model[a] && D.model[a][tk] && D.model[a][tk].peak_r) || 0, rb = (D.model[b] && D.model[b][tk] && D.model[b][tk].peak_r) || 0; return rb - ra; });
    var bigNames = bigCls.map(function (c) { return SHORT[c]; });
    if (w && bigCls.length > 1) h += "<p class='note'>이날은 주차 영향이 있는 공연장 " + bigCls.length + "곳(" + esc(bigNames.join(", ")) + ")에서 함께 공연합니다. 배율은 영향이 가장 큰 " + esc(SHORT[dayCls(s)]) + " 기준이라 실제로는 더 붐빌 수 있습니다.</p>";
    if (w || mineOn(s)) h += timeline(s);
    if (evs.length) h += story(s) + eventList(s);
    var g = "";
    if (evs.length && w && S.prefs.mode === "car") {
      var zs = f.lot.map(function (z) { var r = D.zones.zones[z]; return r ? (f.lot.length > 1 ? z + " " : "") + pct(r.full_share) : null; }).filter(Boolean);
      g += "<dt>주차</dt><dd>" + (f.lot.length ? esc(wa(f.name)) + " 가까운 주차장은 " + f.lot.join("·") + "입니다" + (zs.length ? "(참고: 2025~2026년 혼잡도 기록에서 이 주차장의 상태 변경 중 '만차'가 " + zs.join(", ") + ")" : "") + ". " : "") +
        (mineOn(s) && mins(S.prefs.from) >= mins(w.from) ? "이용 시간이 정해져 있다면 이날은 대중교통 이용을 고려해 보세요." : w.from + " 전에 도착하거나 대중교통을 이용하는 편이 좋습니다.") + "</dd>";
    }
    if (evs.length && w) g += "<dt>대중교통</dt><dd>5·9호선 올림픽공원역이 북2·동2·남2문과 가깝습니다. 기관도 대형 행사일에는 대중교통을 권장합니다.</dd>";
    g += "<dt>잔디</dt><dd>" + lawnTip(s) + "</dd>";
    g += "<dt>실시간</dt><dd>당일 30분 단위 예상 이용률과 실시간 주차 대수는 기관 <a href='" + PARKING_URL + "' rel='noopener' target='_blank'>주차장 예상 이용률 서비스</a>에서 확인하세요.</dd>";
    h += "<dl class='guide'>" + g + "</dl>";
    $("dayBody").innerHTML = h;
  }

  // ------------------------------------------------------------ 구독·ICS
  function icsEsc(s) { return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
  function myIcs() {
    var p = S.prefs, f = fac(), from = todayKST();
    var days = Object.keys(D.byDate).filter(function (s) { return s >= from && overlap(s); }).sort();
    var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//olpark-event-alert//KO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "X-WR-CALNAME:올팍 공연일 (내 이용 시간)", "BEGIN:VTIMEZONE", "TZID:Asia/Seoul", "BEGIN:STANDARD", "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0900", "TZOFFSETTO:+0900", "TZNAME:KST", "END:STANDARD", "END:VTIMEZONE"];
    days.forEach(function (s) {
      var w = win(s), ymd = s.replace(/-/g, "");
      var titles = eventsOn(s).map(function (e) { return e.title + " (" + e.venue + ")"; }).join(" / ");
      L.push("BEGIN:VEVENT", "UID:mine-" + ymd + "-" + p.from.replace(":", "") + "@olpark-event-alert", "DTSTAMP:" + stamp,
        "DTSTART;TZID=Asia/Seoul:" + ymd + "T" + p.from.replace(":", "") + "00", "DTEND;TZID=Asia/Seoul:" + ymd + "T" + p.to.replace(":", "") + "00",
        "SUMMARY:" + icsEsc("올팍 공연일: " + f.name + " 이용 시간과 겹침"),
        "DESCRIPTION:" + icsEsc(titles + "\n주차 증가 참고 시간대 " + w.from + "~" + w.to + " (2025년 실측)\n대중교통: 5·9호선 올림픽공원역\n예상 이용률: " + PARKING_URL),
        "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:내일 올팍 공연일, 이용 시간과 겹침", "TRIGGER:-P1D", "END:VALARM", "END:VEVENT");
    });
    L.push("END:VCALENDAR");
    return { text: L.join("\r\n") + "\r\n", n: days.length };
  }
  function download() {
    var r = myIcs();
    if (!r.n) { alertMsg("앞으로 내 이용 시간과 겹치는 공연일이 없습니다. 요일이나 시간을 바꿔 보세요."); return; }
    var a = el("a", { href: URL.createObjectURL(new Blob([r.text], { type: "text/calendar;charset=utf-8" })), download: "olpark-my-alerts.ics" });
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    alertMsg(r.n + "일치 일정을 내려받았습니다. 휴대폰에서 열면 캘린더에 추가됩니다.");
  }
  function alertMsg(t) { $("copied").textContent = t; }
  function feedUrl(d) { return new URL("feeds/dow-" + d + ".ics", location.href).href; }
  function renderFeeds() {
    var box = $("myFeeds"); box.innerHTML = "";
    var days = [1, 2, 3, 4, 5, 6, 0].filter(function (d) { return S.prefs.days.indexOf(d) >= 0; });
    if (!days.length) { box.innerHTML = "<span class='aux'>요일을 고르면 구독 버튼이 나타납니다.</span>"; return; }
    days.forEach(function (d) {
      var span = el("span", { class: "feed" });
      span.appendChild(el("a", { class: "btn", href: feedUrl(d).replace(/^https?:/, "webcal:") }, DOW[d] + "요일 구독"));
      var c = el("button", { type: "button", class: "textbtn", "aria-label": DOW[d] + "요일 구독 주소 복사" }, "주소 복사");
      c.addEventListener("click", function () {
        var u = feedUrl(d);
        if (navigator.clipboard) navigator.clipboard.writeText(u).then(function () { alertMsg(DOW[d] + "요일 구독 주소를 복사했습니다."); }, function () { alertMsg(u); });
        else alertMsg(u);
      });
      span.appendChild(c); box.appendChild(span);
    });
  }

  // ------------------------------------------------------------ 데이터 출처
  function renderSrc() {
    var m = D.meta, c = m.cpm, z = D.zones, st = D.stats || {}, k = m.check_2024, q = m.quality || {};
    var ten = st.tennis_users_by_year || {}, t25 = ((ten["월회원"] || {})["2025"] || 0) + ((ten["일일입장"] || {})["2025"] || 0);
    var park = (st.monthly_parking_by_place_year || {})["올림픽공원"] || {};
    function span(o) { var y = Object.keys(o).sort(); return y.length ? y[0] + "~" + y[y.length - 1] : ""; }
    var tenYears = {}; Object.keys(ten).forEach(function (k) { Object.keys(ten[k]).forEach(function (y) { tenYears[y] = 1; }); });
    var ad = c.analysed_days || {}, bw = c.baseline_weekend || {}, so = c.small_only_as_normal || {};
    var rows = [
      ["2025 차량입출차·공연·날씨 연계 데이터 (오픈API)", c.span[0] + "~" + c.span[1] + ", 시간별 " + c.rows.toLocaleString() + "건", "기록 있는 " + c.days + "일 중 하루 22시간 이상 관측된 " + c.days_used + "일로 공연장 유형별·평일/주말별 '평소 대비 배율'과 주차 증가 참고 시간대 계산", "https://www.data.go.kr/data/15164822/openapi.do"],
      ["올림픽공원 입출차 정보 (파일)", "2024-07, " + k.rows.toLocaleString() + "건", "보조 사례: 2024년 7월 주말 " + k.weekend_days + "일 중 " + k.weekend_event_days + "일이 공연일, 최대 " + k.max_occ.toLocaleString() + "대(" + k.max_at.slice(5, 16) + ")", "https://www.data.go.kr/data/15138735/fileData.do"],
      ["주차장 혼잡도 정보 (파일)", z.span[0] + "~" + z.span[1] + ", " + z.records + "건", "시설 인근 주차장의 과거 상태 변경 기록 중 '만차' 비중(참고 정보)", "https://www.data.go.kr/data/15164156/fileData.do"],
      ["잔디시설정보 (파일)", "2025-05-12", "정기 잔디 개방·통제 기간", "https://www.data.go.kr/data/15143220/fileData.do"],
      ["월별주차현황, 테니스장 이용 정보 (파일)", "월별주차 " + span(park) + ", 테니스장 " + span(tenYears), "이용 규모: 올림픽공원 연간 주차 " + (park["2025"] ? (+park["2025"]).toLocaleString() + "대" : "") + ", 테니스장 이용 " + t25.toLocaleString() + "명(2025)", "https://www.data.go.kr/data/15131671/fileData.do"],
      ["올림픽공원 공연/행사 일정안내 (기관 누리집)", "달력: 현재 공연 " + m.events_count + "건(" + m.events_span[0] + "~" + m.events_span[1] + ", 장기 공연 기간 포함). 분석: 2024-07, 2025년 일정", "공연장·기간·시간으로 달력과 구독을 만듦. 매일 지난달부터 5개월 뒤까지 읽음. 오픈API 「올림픽공원 공연정보」에는 공연 기간 항목이 없어(" + (q.perf_api && q.perf_api.rows ? q.perf_api.rows.toLocaleString() + "건 점검" : "점검") + ") 누리집 일정을 씀", SCHED_URL]
    ];
    var h = "<div class='tbl-wrap'><table><thead><tr><th scope='col'>데이터 (한국체육산업개발)</th><th scope='col'>범위</th><th scope='col'>쓰는 곳</th></tr></thead><tbody>";
    rows.forEach(function (r) { h += "<tr><td><a href='" + r[3] + "' rel='noopener' target='_blank'>" + esc(r[0]) + "</a></td><td>" + esc(r[1]) + "</td><td>" + esc(r[2]) + "</td></tr>"; });
    h += "</tbody></table></div>";
    h += "<p class='method'>계산 방법. 2025 연계 데이터는 달마다 주차대수 수준이 크게 달라(8·9월이 다른 달보다 크게 낮음) 날마다 그달 '공연 없는 평일' 하루 평균으로 나눠 맞췄습니다. " +
      "그다음 누리집 일정으로 날마다 공연장 유형을 하나 붙이고(같은 날 여러 곳이면 KSPO DOME, 핸드볼경기장, 88잔디마당, 올림픽홀 순), 시간대마다 공연이 없는 같은 요일유형 날의 중앙값과 비교했습니다. 소규모·장기 공연만 있는 날은 공연 없는 날로 셉니다. " +
      "분석한 평일 " + (ad.weekday || "") + "일 중 공연 없는 날은 " + D.normalDays.weekday + "일, 주말·공휴일 " + (ad.weekend || "") + "일 중에는 " + D.normalDays.weekend + "일뿐이고" + (bw.days ? " 그중 토·일은 " + bw.sat_sun + "일(나머지는 설·추석 연휴 등 공휴일)이라" : "이라") + ", 주말·공휴일 배율은 참고 수준으로 보고 기준을 1.5배로 높였습니다(평일 1.3배). " +
      "'내 시간' 배율은 내 이용 시간 안 시간대 배율 중 가장 높은 값입니다. 하루 22시간 이상 기록된 날만 썼고, 2025년 공휴일은 연계 데이터의 '휴일' 항목을, 2026·2027년 공휴일은 한국천문연구원 월력요항을 따릅니다. 7일 넘게 이어지는 장기 공연과 소규모 공연장은 주차 영향 분석에서 제외합니다. " +
      "데이터 생성 " + esc(m.built_at) + ". 공공누리 제1유형(출처표시).</p>";
    $("srcBody").innerHTML = h;
  }

  // ------------------------------------------------------------ 시작
  function render() { renderSummary(); renderCal(); renderFeeds(); if (S.sel) renderDay(); }
  function getJSON(p) { return fetch(p, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(p + " (" + r.status + ")"); return r.json(); }); }
  themeInit();
  Promise.all(["events", "pattern", "zones", "lawn", "meta", "stats"].map(function (n) { return getJSON("data/" + n + ".json"); }))
    .then(function (a) {
      D.events = a[0]; D.model = a[1].model; D.normalDays = a[1].normal_days; D.zones = a[2]; D.lawn = a[3]; D.meta = a[4]; D.stats = a[5];
      D.holidays = D.meta.holidays || [];
      D.byDate = {};
      D.events.forEach(function (e) { (D.byDate[e.date] = D.byDate[e.date] || []).push(e); });
      var t = parseIso(todayKST()); S.y = t.y; S.m = t.m;
      var qd = Q.get("date");
      if (qd && /^\d{4}-\d\d-\d\d$/.test(qd)) { var q = parseIso(qd); S.y = q.y; S.m = q.m; S.sel = qd; }
      else if (!Q.get("fig")) {
        // 첫 화면: 오늘 이후 가장 가까운 '내 시간과 겹치는 날'을 열어 둔다
        var nxt = Object.keys(D.byDate).filter(function (s) { return s >= todayKST() && overlap(s); }).sort()[0];
        if (nxt) { var nq = parseIso(nxt); S.y = nq.y; S.m = nq.m; S.sel = nxt; }
      }
      var built = (D.meta.built_at || "").slice(0, 10);
      if (built && addDays(built, 3) < todayKST()) {
        var n = $("dataNotice"); n.hidden = false;
        n.innerHTML = "공연 일정이 " + esc(built) + " 이후 갱신되지 않았습니다. 최신 일정은 <a href='" + SCHED_URL + "' rel='noopener' target='_blank'>올림픽공원 공연/행사 일정</a>에서 확인하세요.";
      }
      buildForm();
      $("prev").addEventListener("click", function () { S.m--; if (S.m < 0) { S.m = 11; S.y--; } renderCal(); });
      $("next").addEventListener("click", function () { S.m++; if (S.m > 11) { S.m = 0; S.y++; } renderCal(); });
      $("dlMine").addEventListener("click", download);
      $("copyMine").addEventListener("click", function () {
        var u = shareLink();
        if (navigator.clipboard) navigator.clipboard.writeText(u).then(function () { $("mineCopied").textContent = "복사했습니다."; }, function () { $("mineCopied").textContent = u; });
        else $("mineCopied").textContent = u;
      });
      if (S.fromLink) save();
      $("builtAt").textContent = D.meta.built_at;
      renderSrc(); render();
      document.documentElement.setAttribute("data-ready", "1");
    })
    .catch(function (e) {
      var n = $("dataNotice"); n.hidden = false;
      n.innerHTML = "데이터를 불러오지 못했습니다(" + esc(e.message) + "). 새로고침하거나, 공연 일정은 <a href='" + SCHED_URL + "' rel='noopener' target='_blank'>올림픽공원 공연/행사 일정</a>에서 확인하세요.";
      $("monthSum").textContent = "공연 일정을 불러오지 못했습니다.";
    });
})();
