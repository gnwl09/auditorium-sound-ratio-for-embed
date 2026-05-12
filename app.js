const EPSILON = 1e-12;
const URL_PARAMS = new URLSearchParams(window.location.search);
const FULL_MODE = URL_PARAMS.get("full") === "1" || URL_PARAMS.get("embed") === "0";
const EMBED_MODE = !FULL_MODE;

if (EMBED_MODE) {
  document.body.classList.add("embed-mode");
}

const controls = {
  roomWidth: document.querySelector("#roomWidth"),
  roomDepth: document.querySelector("#roomDepth"),
  gridGap: document.querySelector("#gridGap"),
  speakerHeight: document.querySelector("#speakerHeight"),
  ratioK: document.querySelector("#ratioK"),
  kMax: document.querySelector("#kMax"),
  baseDb: document.querySelector("#baseDb"),
};

const numberInputs = {
  roomWidth: document.querySelector("#roomWidthNumber"),
  roomDepth: document.querySelector("#roomDepthNumber"),
  gridGap: document.querySelector("#gridGapNumber"),
  speakerHeight: document.querySelector("#speakerHeightNumber"),
  ratioK: document.querySelector("#ratioKNumber"),
  kMax: document.querySelector("#kMaxNumber"),
  baseDb: document.querySelector("#baseDbNumber"),
};

const ui = {
  currentStd: document.querySelector("#currentStd"),
  currentRange: document.querySelector("#currentRange"),
  bestK: document.querySelector("#bestK"),
  bestStd: document.querySelector("#bestStd"),
  selectedLocation: document.querySelector("#selectedLocation"),
  selectedLevel: document.querySelector("#selectedLevel"),
  summaryText: document.querySelector("#summaryText"),
  curvePointCount: document.querySelector("#curvePointCount"),
  ratioSvg: document.querySelector("#ratioSvg"),
  spreadSvg: document.querySelector("#spreadSvg"),
  frontSeatValue: document.querySelector("#frontSeatValue"),
  middleSeatValue: document.querySelector("#middleSeatValue"),
  backSeatValue: document.querySelector("#backSeatValue"),
  selectedCurveLocation: document.querySelector("#selectedCurveLocation"),
  selectedCurveValue: document.querySelector("#selectedCurveValue"),
  heatmapRange: document.querySelector("#heatmapRange"),
  planSelectedText: document.querySelector("#planSelectedText"),
  planPanel: document.querySelector("#planPanel"),
  seatPopup: document.querySelector("#seatPopup"),
  selectedMiniTitle: document.querySelector("#selectedMiniTitle"),
  selectedMiniSvg: document.querySelector("#selectedMiniSvg"),
  miniCoord: document.querySelector("#miniCoord"),
  miniK: document.querySelector("#miniK"),
  miniL: document.querySelector("#miniL"),
  bestKDetail: document.querySelector("#bestKDetail"),
  bestRangeDetail: document.querySelector("#bestRangeDetail"),
  kGapDetail: document.querySelector("#kGapDetail"),
  swapViewBtn: document.querySelector("#swapViewBtn"),
  curveToMapBtn: document.querySelector("#curveToMapBtn"),
  mapToCurveBtn: document.querySelector("#mapToCurveBtn"),
};

const canvas = {
  plan: document.querySelector("#planCanvas"),
  heatmap: document.querySelector("#heatmapCanvas"),
};

const ctx = {
  plan: canvas.plan.getContext("2d"),
  heatmap: canvas.heatmap.getContext("2d"),
};

const state = {
  activeTab: EMBED_MODE ? "map" : "curves",
  embedMode: EMBED_MODE,
  room: { width: 24, depth: 34 },
  gridRows: [],
  seats: [],
  speakers: [],
  bounds: { x: 0, y: 0, w: 1, h: 1, scale: 1 },
  current: null,
  scan: [],
  best: null,
  representative: [],
  selectedPoint: null,
  selectedSeat: null,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const fmt = (value, digits = 2) => Number(value).toFixed(digits);
const fmtDb = (value, digits = 2) => `${fmt(value, digits)} dB`;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function safeLog10(value) {
  return Math.log10(Math.max(EPSILON, value));
}

function resizeCanvas(target) {
  const rect = target.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(Math.max(320, rect.width || Number(target.width)) * ratio);
  const height = Math.round(Math.max(420, rect.height || Number(target.height)) * ratio);
  if (target.width !== width || target.height !== height) {
    target.width = width;
    target.height = height;
  }
}

function clampControlValue(control, value) {
  const min = Number(control.min);
  const max = Number(control.max);
  return clamp(Number.isFinite(value) ? value : Number(control.value), min, max);
}

function syncNumberInputs() {
  Object.keys(numberInputs).forEach((key) => {
    if (numberInputs[key]) numberInputs[key].value = controls[key].value;
  });
}

function normalizeControlValues() {
  const kMax = clampControlValue(controls.kMax, Number(controls.kMax.value));
  controls.kMax.value = kMax;
  controls.ratioK.max = String(kMax);
  numberInputs.ratioK.max = String(kMax);
  if (Number(controls.ratioK.value) > kMax) controls.ratioK.value = kMax;
}

function updateModel() {
  normalizeControlValues();
  state.room.width = Number(controls.roomWidth.value);
  state.room.depth = Number(controls.roomDepth.value);
  state.speakers = buildSpeakers();
  buildGrid();
  updateSelectedSeat();
  buildRepresentativeSeats();
  buildScan();
  state.current = statsAt(Number(controls.ratioK.value));
  updateText();
  renderActiveTab();
}

function buildSpeakers() {
  const w = state.room.width;
  const d = state.room.depth;
  const h = Number(controls.speakerHeight.value);
  return [
    { name: "앞 L", group: "front", x: w * 0.2, y: d * 0.14, h },
    { name: "앞 R", group: "front", x: w * 0.8, y: d * 0.14, h },
    { name: "중앙 L", group: "center", x: w * 0.34, y: d * 0.52, h },
    { name: "중앙 R", group: "center", x: w * 0.66, y: d * 0.52, h },
  ];
}

function buildGrid() {
  const gap = Number(controls.gridGap.value);
  const rows = [];
  const seats = [];
  const startY = Math.max(gap, state.room.depth * 0.22);
  const endY = state.room.depth - gap * 0.6;
  const startX = gap;
  const endX = state.room.width - gap * 0.6;

  for (let y = startY; y <= endY; y += gap) {
    const row = [];
    for (let x = startX; x <= endX; x += gap) {
      const seat = buildSeat(x, y);
      row.push(seat);
      seats.push(seat);
    }
    rows.push(row);
  }
  state.gridRows = rows;
  state.seats = seats;
}

function updateSelectedSeat() {
  if (!state.selectedPoint) {
    state.selectedPoint = { x: state.room.width * 0.5, y: state.room.depth * 0.54 };
  }
  state.selectedPoint = {
    x: clamp(state.selectedPoint.x, 0, state.room.width),
    y: clamp(state.selectedPoint.y, 0, state.room.depth),
  };
  state.selectedSeat = nearestSeat(state.selectedPoint.x, state.selectedPoint.y);
}

function nearestSeat(x, y) {
  let nearest = state.seats[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  state.seats.forEach((seat) => {
    const distance = (seat.x - x) ** 2 + (seat.y - y) ** 2;
    if (distance < bestDistance) {
      nearest = seat;
      bestDistance = distance;
    }
  });
  return nearest;
}

function buildSeat(x, y) {
  const front = groupContribution(x, y, "front");
  const center = groupContribution(x, y, "center");
  return { x, y, front, center };
}

function groupContribution(x, y, group) {
  return state.speakers
    .filter((speaker) => speaker.group === group)
    .reduce((sum, speaker) => {
      const dx = x - speaker.x;
      const dy = y - speaker.y;
      const distanceSquared = dx * dx + dy * dy + speaker.h * speaker.h;
      return sum + 1 / Math.max(EPSILON, distanceSquared);
    }, 0);
}

function levelAtSeat(seat, k) {
  const baseDb = Number(controls.baseDb.value);
  return baseDb + 10 * safeLog10(seat.front + k * seat.center);
}

function statsAt(k) {
  const levels = state.seats.map((seat) => levelAtSeat(seat, k));
  const mean = levels.reduce((sum, value) => sum + value, 0) / levels.length;
  const variance = levels.reduce((sum, value) => sum + (value - mean) ** 2, 0) / levels.length;
  return {
    k,
    levels,
    mean,
    std: Math.sqrt(variance),
    min: Math.min(...levels),
    max: Math.max(...levels),
    range: Math.max(...levels) - Math.min(...levels),
  };
}

function buildScan() {
  const max = Number(controls.kMax.value);
  const points = [];
  const steps = 180;
  for (let i = 0; i <= steps; i += 1) {
    const k = (max * i) / steps;
    points.push(statsAt(k));
  }
  state.scan = points;
  state.best = points.reduce((best, current) => (current.std < best.std ? current : best), points[0]);
}

function buildRepresentativeSeats() {
  const targets = [
    { name: "앞좌석", shortName: "앞", x: state.room.width * 0.5, y: state.room.depth * 0.28, color: "#111111" },
    { name: "중앙좌석", shortName: "중", x: state.room.width * 0.5, y: state.room.depth * 0.54, color: "#555555" },
    { name: "뒷좌석", shortName: "뒤", x: state.room.width * 0.5, y: state.room.depth * 0.82, color: "#999999" },
  ];
  state.representative = targets.map((target) => {
    let nearest = state.seats[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    state.seats.forEach((seat) => {
      const distance = (seat.x - target.x) ** 2 + (seat.y - target.y) ** 2;
      if (distance < bestDistance) {
        nearest = seat;
        bestDistance = distance;
      }
    });
    return { ...target, seat: nearest };
  });
}

function updateText() {
  const k = Number(controls.ratioK.value);
  syncNumberInputs();
  ui.currentStd.textContent = fmtDb(state.current.std, 2);
  ui.currentRange.textContent = fmtDb(state.current.range, 2);
  ui.bestK.textContent = state.best.k.toFixed(2);
  ui.bestStd.textContent = fmtDb(state.best.std, 2);
  const selectedLevel = levelAtSeat(state.selectedSeat, k);
  ui.selectedLocation.textContent = `(${state.selectedSeat.x.toFixed(1)}, ${state.selectedSeat.y.toFixed(1)})`;
  ui.selectedLevel.textContent = `k=${k.toFixed(2)} · ${fmtDb(selectedLevel, 2)}`;
  ui.summaryText.textContent = `현재 k=${k.toFixed(2)}에서 강당 전체 좌석의 데시벨 범위는 ${fmtDb(state.current.range, 2)}입니다. 최적 k는 ${state.best.k.toFixed(2)}로 계산됩니다.`;
  ui.curvePointCount.textContent = `${state.seats.length.toLocaleString("ko-KR")}개 좌석 곡선`;
  ui.heatmapRange.textContent = `${fmtDb(state.current.min, 1)} - ${fmtDb(state.current.max, 1)}`;
  ui.planSelectedText.textContent = `선택 (${state.selectedSeat.x.toFixed(1)}, ${state.selectedSeat.y.toFixed(1)}) · ${fmtDb(selectedLevel, 1)}`;
  ui.selectedMiniTitle.textContent = `(${state.selectedSeat.x.toFixed(1)}, ${state.selectedSeat.y.toFixed(1)})`;
  ui.miniCoord.textContent = `(${state.selectedSeat.x.toFixed(1)}, ${state.selectedSeat.y.toFixed(1)})`;
  ui.miniK.textContent = k.toFixed(2);
  ui.miniL.textContent = fmtDb(selectedLevel, 2);
  ui.bestKDetail.textContent = state.best.k.toFixed(2);
  ui.bestRangeDetail.textContent = fmtDb(state.best.range, 2);
  ui.kGapDetail.textContent = `${Math.abs(k - state.best.k).toFixed(2)}`;

  const repValues = state.representative.map((rep) => fmtDb(levelAtSeat(rep.seat, k), 2));
  ui.selectedCurveLocation.textContent = `(${state.selectedSeat.x.toFixed(1)}, ${state.selectedSeat.y.toFixed(1)})`;
  ui.frontSeatValue.textContent = repValues[0];
  ui.middleSeatValue.textContent = repValues[1];
  ui.backSeatValue.textContent = repValues[2];
  ui.selectedCurveValue.textContent = `k=${k.toFixed(2)} · ${fmtDb(selectedLevel, 2)}`;
  updateSwapButton();
}

function renderActiveTab() {
  if (state.activeTab === "curves") drawRatioGraph();
  if (state.activeTab === "map") {
    drawPlan();
    drawHeatmap();
    drawSelectedMiniGraph();
    updateSeatPopupPosition();
  }
  if (state.activeTab === "spread") drawSpreadGraph();
}

function ratioGraphMetrics() {
  const width = 980;
  const height = 620;
  const margin = { top: 42, right: 42, bottom: 74, left: 82 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const kMax = Number(controls.kMax.value);
  const allLevels = [];
  state.scan.forEach((scanPoint) => allLevels.push(scanPoint.min, scanPoint.max));
  const yMin = Math.floor(Math.min(...allLevels) - 1);
  const yMax = Math.ceil(Math.max(...allLevels) + 1);
  const xScale = (k) => margin.left + (k / kMax) * plotW;
  const yScale = (level) => margin.top + (1 - (level - yMin) / (yMax - yMin)) * plotH;
  const kFromX = (x) => clamp(((x - margin.left) / plotW) * kMax, 0, kMax);
  const levelFromY = (y) => yMin + (1 - (y - margin.top) / plotH) * (yMax - yMin);
  return { width, height, margin, plotW, plotH, kMax, yMin, yMax, xScale, yScale, kFromX, levelFromY };
}

function drawRatioGraph() {
  const { width, height, margin, plotW, plotH, kMax, yMin, yMax, xScale, yScale } = ratioGraphMetrics();
  const sampledSeats = sampleItems(state.seats, 140);
  const kValues = Array.from({ length: 130 }, (_, i) => (kMax * i) / 129);
  const thinPaths = sampledSeats.map((seat) => pathForSeat(seat, kValues, xScale, yScale));
  const repPaths = state.representative.map((rep) => ({
    ...rep,
    path: pathForSeat(rep.seat, kValues, xScale, yScale),
  }));
  const selectedPath = pathForSeat(state.selectedSeat, kValues, xScale, yScale);
  const tickXs = makeTicks(0, kMax, 6);
  const tickYs = makeTicks(yMin, yMax, 7);
  const currentK = Number(controls.ratioK.value);
  const selectedLevel = levelAtSeat(state.selectedSeat, currentK);
  const labelText = `(${state.selectedSeat.x.toFixed(1)}, ${state.selectedSeat.y.toFixed(1)})`;
  const pointX = xScale(currentK);
  const pointY = yScale(selectedLevel);
  const labelX = clamp(pointX + 12, margin.left + 8, margin.left + plotW - 130);
  const labelY = clamp(pointY - 38, margin.top + 8, margin.top + plotH - 32);

  ui.ratioSvg.innerHTML = `
    <rect width="${width}" height="${height}" fill="#ffffff"></rect>
    ${gridLines(tickXs, tickYs, xScale, yScale, margin, width, height)}
    ${axes(margin, width, height)}
    ${axisLabels("k (중앙 스피커 / 앞 스피커 세기 비율)", "L_i(k) 데시벨", margin, width, height)}
    ${tickLabels(tickXs, tickYs, xScale, yScale, margin, height)}
    <g fill="none" stroke="#111111" stroke-width="1" opacity="0.12">
      ${thinPaths.map((path) => `<path d="${path}"></path>`).join("")}
    </g>
    <g fill="none" stroke-width="3.2">
      ${repPaths.map((rep) => `<path d="${rep.path}" stroke="${rep.color}"></path>`).join("")}
    </g>
    <path d="${selectedPath}" fill="none" stroke="#111111" stroke-width="4.5" stroke-linecap="round"></path>
    <line x1="${xScale(currentK)}" y1="${margin.top}" x2="${xScale(currentK)}" y2="${height - margin.bottom}" stroke="${cssVar("--gold")}" stroke-width="3"></line>
    <line x1="${xScale(state.best.k)}" y1="${margin.top}" x2="${xScale(state.best.k)}" y2="${height - margin.bottom}" stroke="${cssVar("--green")}" stroke-width="3" stroke-dasharray="9 8"></line>
    <circle cx="${pointX}" cy="${pointY}" r="7" fill="#111111" stroke="#ffffff" stroke-width="3"></circle>
    <g font-family="system-ui, sans-serif">
      <rect x="${labelX}" y="${labelY}" width="122" height="28" rx="7" fill="#111111" opacity="0.92"></rect>
      <text x="${labelX + 61}" y="${labelY + 19}" text-anchor="middle" fill="#ffffff" font-size="12" font-weight="850">${labelText}</text>
    </g>
    ${legend(width)}
  `;
}

function pathForSeat(seat, kValues, xScale, yScale) {
  return kValues.map((k, index) => {
    const command = index === 0 ? "M" : "L";
    return `${command} ${xScale(k).toFixed(2)} ${yScale(levelAtSeat(seat, k)).toFixed(2)}`;
  }).join(" ");
}

function drawSpreadGraph() {
  const width = 980;
  const height = 620;
  const margin = { top: 42, right: 42, bottom: 74, left: 82 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const kMax = Number(controls.kMax.value);
  const yMax = Math.ceil(Math.max(...state.scan.map((item) => item.range)) + 1);
  const xScale = (k) => margin.left + (k / kMax) * plotW;
  const yScale = (value) => margin.top + (1 - value / yMax) * plotH;
  const tickXs = makeTicks(0, kMax, 6);
  const tickYs = makeTicks(0, yMax, 7);
  const stdPath = state.scan.map((item, index) => `${index === 0 ? "M" : "L"} ${xScale(item.k).toFixed(2)} ${yScale(item.std).toFixed(2)}`).join(" ");
  const rangePath = state.scan.map((item, index) => `${index === 0 ? "M" : "L"} ${xScale(item.k).toFixed(2)} ${yScale(item.range).toFixed(2)}`).join(" ");
  const currentK = Number(controls.ratioK.value);

  ui.spreadSvg.innerHTML = `
    <rect width="${width}" height="${height}" fill="#ffffff"></rect>
    ${gridLines(tickXs, tickYs, xScale, yScale, margin, width, height)}
    ${axes(margin, width, height)}
    ${axisLabels("k (중앙 스피커 / 앞 스피커 세기 비율)", "데시벨 차이", margin, width, height)}
    ${tickLabels(tickXs, tickYs, xScale, yScale, margin, height)}
    <path d="${rangePath}" fill="none" stroke="${cssVar("--violet")}" stroke-width="3.5"></path>
    <path d="${stdPath}" fill="none" stroke="${cssVar("--green")}" stroke-width="4"></path>
    <line x1="${xScale(currentK)}" y1="${margin.top}" x2="${xScale(currentK)}" y2="${height - margin.bottom}" stroke="${cssVar("--gold")}" stroke-width="3"></line>
    <line x1="${xScale(state.best.k)}" y1="${margin.top}" x2="${xScale(state.best.k)}" y2="${height - margin.bottom}" stroke="${cssVar("--green")}" stroke-width="3" stroke-dasharray="9 8"></line>
    <g font-family="system-ui, sans-serif">
      <rect x="${width - 265}" y="38" width="220" height="92" rx="7" fill="#fff" stroke="#d8dfdc"></rect>
      <line x1="${width - 242}" y1="65" x2="${width - 214}" y2="65" stroke="${cssVar("--green")}" stroke-width="4"></line>
      <text x="${width - 204}" y="70" fill="#444444" font-size="13" font-weight="800">표준편차 σ(k)</text>
      <line x1="${width - 242}" y1="96" x2="${width - 214}" y2="96" stroke="${cssVar("--violet")}" stroke-width="4"></line>
      <text x="${width - 204}" y="101" fill="#444444" font-size="13" font-weight="800">범위 R(k)</text>
    </g>
  `;
}

function drawSelectedMiniGraph() {
  const width = 380;
  const height = 300;
  const margin = { top: 28, right: 18, bottom: 48, left: 52 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const kMax = Number(controls.kMax.value);
  const currentK = Number(controls.ratioK.value);
  const values = Array.from({ length: 140 }, (_, index) => {
    const k = (kMax * index) / 139;
    return { k, level: levelAtSeat(state.selectedSeat, k) };
  });
  const minLevel = Math.min(...values.map((item) => item.level));
  const maxLevel = Math.max(...values.map((item) => item.level));
  const pad = Math.max(0.5, (maxLevel - minLevel) * 0.14);
  const yMin = minLevel - pad;
  const yMax = maxLevel + pad;
  const xScale = (k) => margin.left + (k / kMax) * plotW;
  const yScale = (level) => margin.top + (1 - (level - yMin) / (yMax - yMin)) * plotH;
  const path = values.map((item, index) => `${index === 0 ? "M" : "L"} ${xScale(item.k).toFixed(2)} ${yScale(item.level).toFixed(2)}`).join(" ");
  const currentLevel = levelAtSeat(state.selectedSeat, currentK);
  const ticksX = makeTicks(0, kMax, 4);
  const ticksY = makeTicks(yMin, yMax, 4);

  ui.selectedMiniSvg.innerHTML = `
    <rect width="${width}" height="${height}" fill="#ffffff"></rect>
    <g>
      ${ticksX.map((x) => `<line x1="${xScale(x)}" y1="${margin.top}" x2="${xScale(x)}" y2="${height - margin.bottom}" stroke="rgba(0,0,0,0.08)"></line>`).join("")}
      ${ticksY.map((y) => `<line x1="${margin.left}" y1="${yScale(y)}" x2="${width - margin.right}" y2="${yScale(y)}" stroke="rgba(0,0,0,0.08)"></line>`).join("")}
    </g>
    <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#111111" stroke-width="1.8"></line>
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#111111" stroke-width="1.8"></line>
    <path d="${path}" fill="none" stroke="#111111" stroke-width="4" stroke-linecap="round"></path>
    <line x1="${xScale(currentK)}" y1="${margin.top}" x2="${xScale(currentK)}" y2="${height - margin.bottom}" stroke="${cssVar("--gold")}" stroke-width="3"></line>
    <circle cx="${xScale(currentK)}" cy="${yScale(currentLevel)}" r="6" fill="${cssVar("--gold")}" stroke="#ffffff" stroke-width="3"></circle>
    <g font-family="system-ui, sans-serif" font-size="11" fill="#555555">
      ${ticksX.map((x) => `<text x="${xScale(x)}" y="${height - margin.bottom + 19}" text-anchor="middle">${fmt(x, 1)}</text>`).join("")}
      ${ticksY.map((y) => `<text x="${margin.left - 8}" y="${yScale(y) + 4}" text-anchor="end">${fmt(y, 1)}</text>`).join("")}
    </g>
    <text x="${margin.left + plotW / 2}" y="${height - 9}" text-anchor="middle" fill="#111111" font-size="12" font-weight="850">k</text>
    <text transform="translate(16 ${margin.top + plotH / 2}) rotate(-90)" text-anchor="middle" fill="#111111" font-size="12" font-weight="850">L_i(k)</text>
  `;
}

function drawPlan() {
  setupBounds(canvas.plan);
  const c = ctx.plan;
  c.clearRect(0, 0, canvas.plan.width, canvas.plan.height);
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, canvas.plan.width, canvas.plan.height);
  drawRoomShell(c);
  drawSeats(c, state.current);
  drawSpeakers(c);
  drawRepresentativeSeats(c);
  drawSelectedSeat(c);
  drawCanvasLegend(c, state.bounds.x + 14, state.bounds.y + state.bounds.h - 46, state.current.min, state.current.max);
  updateSeatPopupPosition();
}

function updateSeatPopupPosition() {
  if (state.activeTab !== "map") return;
  const popup = ui.seatPopup;
  const panelRect = ui.planPanel.getBoundingClientRect();
  const canvasRect = canvas.plan.getBoundingClientRect();
  const seatPoint = roomToCanvas(state.selectedSeat.x, state.selectedSeat.y);
  const seatX = canvasRect.left - panelRect.left + (seatPoint.x / canvas.plan.width) * canvasRect.width;
  const seatY = canvasRect.top - panelRect.top + (seatPoint.y / canvas.plan.height) * canvasRect.height;
  const popupWidth = popup.offsetWidth || 330;
  const popupHeight = popup.offsetHeight || 320;
  const gap = 18;
  const panelWidth = panelRect.width;
  const panelHeight = panelRect.height;
  let left = seatX + gap;
  if (left + popupWidth > panelWidth - 10) left = seatX - popupWidth - gap;
  left = clamp(left, 10, Math.max(10, panelWidth - popupWidth - 10));
  const top = clamp(seatY - 48, 66, Math.max(66, panelHeight - popupHeight - 10));
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

function drawHeatmap() {
  resizeCanvas(canvas.heatmap);
  const c = ctx.heatmap;
  c.clearRect(0, 0, canvas.heatmap.width, canvas.heatmap.height);
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, canvas.heatmap.width, canvas.heatmap.height);
  const plot = heatmapPlot(canvas.heatmap);
  const cellW = plot.w / state.gridRows[0].length;
  const cellH = plot.h / state.gridRows.length;
  const k = Number(controls.ratioK.value);
  state.gridRows.forEach((row, yi) => {
    row.forEach((seat, xi) => {
      const level = levelAtSeat(seat, k);
      c.fillStyle = colorScale(level, state.current.min, state.current.max);
      c.fillRect(plot.x + xi * cellW, plot.y + yi * cellH, cellW + 0.5, cellH + 0.5);
    });
  });
  c.strokeStyle = "#111111";
  c.lineWidth = 1.5;
  c.strokeRect(plot.x, plot.y, plot.w, plot.h);
  c.fillStyle = cssVar("--stage");
  c.fillRect(plot.x, plot.y, plot.w, Math.max(32, plot.h * 0.12));
  c.fillStyle = "#ffffff";
  c.textAlign = "center";
  c.font = "bold 14px sans-serif";
  c.fillText("무대", plot.x + plot.w / 2, plot.y + Math.max(22, plot.h * 0.07));
  drawHeatmapSpeakers(c, plot);
  drawHeatmapRepresentativeSeats(c, plot);
  drawHeatmapSelectedSeat(c, plot);
  drawCanvasLegend(c, plot.x, plot.y + plot.h + 28, state.current.min, state.current.max);
}

function heatmapPlot(target) {
  const pad = Math.min(target.width, target.height) * 0.1;
  return { x: pad, y: pad * 0.8, w: target.width - pad * 2, h: target.height - pad * 1.6 };
}

function setupBounds(target) {
  resizeCanvas(target);
  const pad = Math.min(target.width, target.height) * 0.08;
  const scale = Math.min((target.width - pad * 2) / state.room.width, (target.height - pad * 2) / state.room.depth);
  const w = state.room.width * scale;
  const h = state.room.depth * scale;
  state.bounds = { x: (target.width - w) / 2, y: (target.height - h) / 2, w, h, scale };
}

function roomToCanvas(x, y) {
  return { x: state.bounds.x + x * state.bounds.scale, y: state.bounds.y + y * state.bounds.scale };
}

function drawRoomShell(c) {
  c.fillStyle = "#ffffff";
  c.strokeStyle = "#111111";
  c.lineWidth = 2;
  c.beginPath();
  c.roundRect(state.bounds.x, state.bounds.y, state.bounds.w, state.bounds.h, 6);
  c.fill();
  c.stroke();
  const stageH = Math.max(52, state.bounds.h * 0.14);
  c.fillStyle = cssVar("--stage");
  c.beginPath();
  c.roundRect(state.bounds.x + 10, state.bounds.y + 10, state.bounds.w - 20, stageH, 4);
  c.fill();
  c.fillStyle = "#ffffff";
  c.textAlign = "center";
  c.font = "bold 16px sans-serif";
  c.fillText("무대", state.bounds.x + state.bounds.w / 2, state.bounds.y + stageH / 2 + 8);
}

function drawSeats(c, stats) {
  const k = Number(controls.ratioK.value);
  state.seats.forEach((seat) => {
    const p = roomToCanvas(seat.x, seat.y);
    const r = clamp(state.bounds.scale * 0.13, 2, 4);
    c.fillStyle = colorScale(levelAtSeat(seat, k), stats.min, stats.max);
    c.strokeStyle = "rgba(0, 0, 0, 0.2)";
    c.lineWidth = 0.8;
    c.globalAlpha = 0.9;
    c.beginPath();
    c.arc(p.x, p.y, r, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  });
  c.globalAlpha = 1;
}

function drawSpeakers(c) {
  state.speakers.forEach((speaker) => {
    const p = roomToCanvas(speaker.x, speaker.y);
    const isFront = speaker.group === "front";
    c.fillStyle = isFront ? "#111111" : "#ffffff";
    c.strokeStyle = "#111111";
    c.lineWidth = 3;
    c.beginPath();
    c.arc(p.x, p.y, 12, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = isFront ? "#ffffff" : "#111111";
    c.font = "bold 12px sans-serif";
    c.textAlign = "center";
    c.fillText(isFront ? "F" : "C", p.x, p.y + 4);
  });
}

function drawRepresentativeSeats(c) {
  const ratio = window.devicePixelRatio || 1;
  state.representative.forEach((rep, index) => {
    const p = roomToCanvas(rep.seat.x, rep.seat.y);
    const label = `${rep.shortName} 대표`;
    const labelW = 68 * ratio;
    const labelH = 26 * ratio;
    const labelSide = index === 0 ? 1 : -1;
    const labelX = clamp(
      p.x + labelSide * 16 * ratio - (labelSide < 0 ? labelW : 0),
      state.bounds.x + 8 * ratio,
      state.bounds.x + state.bounds.w - labelW - 8 * ratio
    );
    const labelY = clamp(p.y - 30 * ratio + index * 5 * ratio, state.bounds.y + 70 * ratio, state.bounds.y + state.bounds.h - labelH - 8 * ratio);

    c.save();
    c.strokeStyle = "#111111";
    c.fillStyle = "#ffffff";
    c.lineWidth = 2.4 * ratio;
    c.setLineDash([5 * ratio, 4 * ratio]);
    c.beginPath();
    c.arc(p.x, p.y, 15 * ratio, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);

    c.beginPath();
    c.roundRect(labelX, labelY, labelW, labelH, 5 * ratio);
    c.fill();
    c.stroke();
    c.fillStyle = "#111111";
    c.font = `bold ${11 * ratio}px sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(label, labelX + labelW / 2, labelY + labelH / 2 + 0.5);
    c.restore();
  });
}

function drawSelectedSeat(c) {
  const p = roomToCanvas(state.selectedSeat.x, state.selectedSeat.y);
  c.strokeStyle = "#111111";
  c.fillStyle = "#ffffff";
  c.lineWidth = 4;
  c.beginPath();
  c.arc(p.x, p.y, 15, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.fillStyle = "#111111";
  c.font = "bold 12px sans-serif";
  c.textAlign = "center";
  c.fillText("L", p.x, p.y + 4);
}

function drawHeatmapSpeakers(c, plot) {
  state.speakers.forEach((speaker) => {
    const x = plot.x + (speaker.x / state.room.width) * plot.w;
    const y = plot.y + (speaker.y / state.room.depth) * plot.h;
    const isFront = speaker.group === "front";
    c.fillStyle = isFront ? "#111111" : "#ffffff";
    c.strokeStyle = "#111111";
    c.lineWidth = 2.2;
    c.beginPath();
    c.arc(x, y, 8, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = isFront ? "#ffffff" : "#111111";
    c.font = "bold 9px sans-serif";
    c.textAlign = "center";
    c.fillText(isFront ? "F" : "C", x, y + 3);
  });
}

function drawHeatmapRepresentativeSeats(c, plot) {
  const ratio = window.devicePixelRatio || 1;
  state.representative.forEach((rep, index) => {
    const x = plot.x + (rep.seat.x / state.room.width) * plot.w;
    const y = plot.y + (rep.seat.y / state.room.depth) * plot.h;
    const label = `${rep.shortName} 대표`;
    const labelW = 56 * ratio;
    const labelH = 22 * ratio;
    const labelSide = index === 0 ? 1 : -1;
    const labelX = clamp(
      x + labelSide * 12 * ratio - (labelSide < 0 ? labelW : 0),
      plot.x + 6 * ratio,
      plot.x + plot.w - labelW - 6 * ratio
    );
    const labelY = clamp(y - 26 * ratio + index * 4 * ratio, plot.y + Math.max(34 * ratio, plot.h * 0.12 + 6 * ratio), plot.y + plot.h - labelH - 6 * ratio);

    c.save();
    c.strokeStyle = "#111111";
    c.fillStyle = "#ffffff";
    c.lineWidth = 2 * ratio;
    c.setLineDash([4 * ratio, 4 * ratio]);
    c.beginPath();
    c.arc(x, y, 12 * ratio, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);

    c.beginPath();
    c.roundRect(labelX, labelY, labelW, labelH, 4 * ratio);
    c.fill();
    c.stroke();
    c.fillStyle = "#111111";
    c.font = `bold ${9.5 * ratio}px sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(label, labelX + labelW / 2, labelY + labelH / 2 + 0.5);
    c.restore();
  });
}

function drawHeatmapSelectedSeat(c, plot) {
  const x = plot.x + (state.selectedSeat.x / state.room.width) * plot.w;
  const y = plot.y + (state.selectedSeat.y / state.room.depth) * plot.h;
  c.fillStyle = "#ffffff";
  c.strokeStyle = "#111111";
  c.lineWidth = 4;
  c.beginPath();
  c.arc(x, y, 12, 0, Math.PI * 2);
  c.fill();
  c.stroke();
}

function drawCanvasLegend(c, x, y, min, max) {
  const w = 170;
  const h = 10;
  for (let i = 0; i < w; i += 1) {
    c.fillStyle = colorScale(lerp(min, max, i / (w - 1)), min, max);
    c.fillRect(x + i, y, 1, h);
  }
  c.strokeStyle = "rgba(0,0,0,0.35)";
  c.strokeRect(x, y, w, h);
  c.fillStyle = "#333333";
  c.font = "bold 12px sans-serif";
  c.textAlign = "left";
  c.fillText("L dB", x, y - 7);
  c.fillText(fmt(min, 1), x, y + h + 16);
  c.fillText(fmt(max, 1), x + w - 34, y + h + 16);
}

function canvasPoint(event, target) {
  const rect = target.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (target.width / rect.width),
    y: (event.clientY - rect.top) * (target.height / rect.height),
  };
}

function svgPoint(event, target, width, height) {
  const rect = target.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * width,
    y: ((event.clientY - rect.top) / rect.height) * height,
  };
}

function selectSeatFromRoom(x, y) {
  state.selectedPoint = {
    x: clamp(x, 0, state.room.width),
    y: clamp(y, 0, state.room.depth),
  };
  updateSelectedSeat();
  updateText();
  renderActiveTab();
}

function selectSeatFromPlan(event) {
  setupBounds(canvas.plan);
  const point = canvasPoint(event, canvas.plan);
  const x = (point.x - state.bounds.x) / state.bounds.scale;
  const y = (point.y - state.bounds.y) / state.bounds.scale;
  selectSeatFromRoom(x, y);
}

function selectSeatFromHeatmap(event) {
  resizeCanvas(canvas.heatmap);
  const plot = heatmapPlot(canvas.heatmap);
  const point = canvasPoint(event, canvas.heatmap);
  const x = ((point.x - plot.x) / plot.w) * state.room.width;
  const y = ((point.y - plot.y) / plot.h) * state.room.depth;
  selectSeatFromRoom(x, y);
}

function nearestSeatByLevel(k, targetLevel) {
  let nearest = state.seats[0];
  let bestGap = Number.POSITIVE_INFINITY;
  state.seats.forEach((seat) => {
    const gap = Math.abs(levelAtSeat(seat, k) - targetLevel);
    if (gap < bestGap) {
      nearest = seat;
      bestGap = gap;
    }
  });
  return nearest;
}

function selectSeatFromRatioGraph(event) {
  const metrics = ratioGraphMetrics();
  const point = svgPoint(event, ui.ratioSvg, metrics.width, metrics.height);
  const withinPlot =
    point.x >= metrics.margin.left &&
    point.x <= metrics.width - metrics.margin.right &&
    point.y >= metrics.margin.top &&
    point.y <= metrics.height - metrics.margin.bottom;

  if (!withinPlot) return;

  const k = metrics.kFromX(point.x);
  const targetLevel = metrics.levelFromY(point.y);
  const nearest = nearestSeatByLevel(k, targetLevel);
  controls.ratioK.value = k.toFixed(2);
  state.selectedPoint = { x: nearest.x, y: nearest.y };
  updateModel();
}

function colorScale(value, min, max) {
  const t = max === min ? 0.5 : clamp((value - min) / (max - min), 0, 1);
  const shade = Math.round(236 - t * 178);
  return `rgb(${shade}, ${shade}, ${shade})`;
}

function sampleItems(items, maxCount) {
  if (items.length <= maxCount) return items;
  const step = Math.ceil(items.length / maxCount);
  return items.filter((_, index) => index % step === 0);
}

function makeTicks(min, max, count) {
  return Array.from({ length: count }, (_, index) => lerp(min, max, index / (count - 1)));
}

function gridLines(tickXs, tickYs, xScale, yScale, margin, width, height) {
  return `
    <g>
      ${tickXs.map((x) => `<line x1="${xScale(x)}" y1="${margin.top}" x2="${xScale(x)}" y2="${height - margin.bottom}" stroke="rgba(0,0,0,0.08)"></line>`).join("")}
      ${tickYs.map((y) => `<line x1="${margin.left}" y1="${yScale(y)}" x2="${width - margin.right}" y2="${yScale(y)}" stroke="rgba(0,0,0,0.08)"></line>`).join("")}
    </g>
  `;
}

function axes(margin, width, height) {
  return `
    <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#111111" stroke-width="2"></line>
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#111111" stroke-width="2"></line>
  `;
}

function axisLabels(xLabel, yLabel, margin, width, height) {
  return `
    <text x="${margin.left + (width - margin.left - margin.right) / 2}" y="${height - 24}" text-anchor="middle" fill="#111111" font-size="16" font-weight="850">${xLabel}</text>
    <text transform="translate(25 ${margin.top + (height - margin.top - margin.bottom) / 2}) rotate(-90)" text-anchor="middle" fill="#111111" font-size="16" font-weight="850">${yLabel}</text>
  `;
}

function tickLabels(tickXs, tickYs, xScale, yScale, margin, height) {
  return `
    <g font-family="system-ui, sans-serif" font-size="13" fill="#555555">
      ${tickXs.map((x) => `<text x="${xScale(x)}" y="${height - margin.bottom + 24}" text-anchor="middle">${fmt(x, 1)}</text>`).join("")}
      ${tickYs.map((y) => `<text x="${margin.left - 12}" y="${yScale(y) + 4}" text-anchor="end">${fmt(y, 1)}</text>`).join("")}
    </g>
  `;
}

function legend(width) {
  return `
    <g font-family="system-ui, sans-serif">
      <rect x="${width - 280}" y="38" width="235" height="154" rx="7" fill="#fff" stroke="#d8dfdc"></rect>
      <line x1="${width - 256}" y1="65" x2="${width - 226}" y2="65" stroke="#111111" stroke-width="2" opacity="0.35"></line>
      <text x="${width - 216}" y="70" fill="#444444" font-size="13" font-weight="800">전체 좌석 곡선</text>
      <line x1="${width - 256}" y1="94" x2="${width - 226}" y2="94" stroke="#777777" stroke-width="4"></line>
      <text x="${width - 216}" y="99" fill="#444444" font-size="13" font-weight="800">앞/중앙/뒤 대표</text>
      <line x1="${width - 256}" y1="123" x2="${width - 226}" y2="123" stroke="#111111" stroke-width="5"></line>
      <text x="${width - 216}" y="128" fill="#444444" font-size="13" font-weight="800">선택 좌석 곡선</text>
      <line x1="${width - 256}" y1="149" x2="${width - 226}" y2="149" stroke="#555555" stroke-width="4"></line>
      <text x="${width - 216}" y="154" fill="#444444" font-size="13" font-weight="800">현재 k</text>
      <line x1="${width - 256}" y1="176" x2="${width - 226}" y2="176" stroke="#111111" stroke-width="4" stroke-dasharray="7 6"></line>
      <text x="${width - 216}" y="181" fill="#444444" font-size="13" font-weight="800">최적 k</text>
    </g>
  `;
}

function updateSwapButton() {
  if (!ui.swapViewBtn) return;
  ui.swapViewBtn.textContent = state.activeTab === "map" ? "로그함수로 보기" : "강당 분포로 보기";
}

function toggleMainView() {
  setTab(state.activeTab === "map" ? "curves" : "map");
}

function setTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === tab);
  });
  updateSwapButton();
  requestAnimationFrame(renderActiveTab);
}

function reset() {
  controls.roomWidth.value = 24;
  controls.roomDepth.value = 34;
  controls.gridGap.value = 1.5;
  controls.speakerHeight.value = 4;
  controls.ratioK.value = 1;
  controls.kMax.value = 4;
  controls.baseDb.value = 78;
  state.selectedPoint = null;
  updateModel();
}

Object.values(controls).forEach((control) => {
  control.addEventListener("input", updateModel);
});

Object.entries(numberInputs).forEach(([key, input]) => {
  input.addEventListener("input", () => {
    if (input.value === "") return;
    controls[key].value = clampControlValue(controls[key], Number(input.value));
    updateModel();
  });
  input.addEventListener("change", () => {
    controls[key].value = clampControlValue(controls[key], Number(input.value));
    updateModel();
  });
});

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => setTab(button.dataset.tab));
});

ui.ratioSvg.addEventListener("click", selectSeatFromRatioGraph);
canvas.plan.addEventListener("click", selectSeatFromPlan);
canvas.heatmap.addEventListener("click", selectSeatFromHeatmap);
ui.swapViewBtn.addEventListener("click", toggleMainView);
ui.curveToMapBtn.addEventListener("click", () => setTab("map"));
ui.mapToCurveBtn.addEventListener("click", () => setTab("curves"));
document.querySelector("#resetBtn").addEventListener("click", reset);
window.addEventListener("resize", () => requestAnimationFrame(renderActiveTab));

reset();
setTab(state.activeTab);
