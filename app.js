/* ========= Configuration ========= */
const BUILT_IN_CSV = "MakitaExport.csv";

/* ========= Plotly theme ========= */
const baseLayout = {
  paper_bgcolor: "rgba(255,255,255,0)",
  plot_bgcolor: "rgba(255,255,255,0)",
  font: { family: "Inter, system-ui, Segoe UI, Arial, sans-serif", color: "#1f2530" },
  margin: { t: 56, l: 64, r: 18, b: 60 }
};

/* ========= Status colours (auto assigns pastel palette per unique status) ========= */
const STATUS_PALETTE = ["#6aa6ff","#ff9fb3","#90e0c5","#ffd08a","#c9b6ff","#8fd3ff","#ffc6a8","#b2e1a1","#f5b3ff","#a4b0ff","#c7f0ff","#ffe3a3"];
let statusColour = new Map();

function pickColour(i){ return STATUS_PALETTE[i % STATUS_PALETTE.length]; }

/* ========= Utils ========= */
function toNumber(v){
  if (v == null) return NaN;
  const s = String(v).replace(/[,£%]/g,"").trim();
  if (!s) return NaN;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}
function truthy(v){
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  if (["y","yes","true","1","t"].includes(s)) return true;
  if (["n","no","false","0","f"].includes(s)) return false;
  return s.includes("yes") || s.includes("true");
}
function fmtGBP(n){
  return Number.isFinite(n)
    ? new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP"}).format(n)
    : "–";
}
function fmtInt(n){
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-GB") : "–";
}
function fmtPct(n){
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "–";
}
const sum = arr => arr.reduce((s,v)=> s + (Number.isFinite(v) ? v : 0), 0);
const clamp = (v,min,max)=> Math.max(min, Math.min(max, v));
const debounce = (fn,ms=160)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

function chartHeight(id){
  return document.getElementById(id)?.clientHeight || 460;
}
function safePlot(id, traces, layout){
  Plotly.newPlot(id, traces, { ...baseLayout, ...layout, height: chartHeight(id) }, { responsive: true });
}

/* ========= State ========= */
let rows = [];

/* ========= CSV ========= */
function parseCSVText(csvText){
  return new Promise((resolve,reject)=>{
    Papa.parse(csvText,{
      header: true,
      skipEmptyLines: "greedy",
      dynamicTyping: false,
      complete: r => resolve(r.data || []),
      error: reject
    });
  });
}
async function loadFromFile(file){
  const txt = await file.text();
  hydrate(await parseCSVText(txt));
}
async function loadFromPath(path){
  const r = await fetch(path, { cache: "no-store" });
  if(!r.ok) throw new Error("Fetch CSV failed");
  hydrate(await parseCSVText(await r.text()));
}

/* ========= Hydrate (focus on columns T to AE) ========= */
function hydrate(rawRows){
  const cleaned = (rawRows || []).filter(r => Object.values(r).some(v => String(v ?? "").trim() !== ""));

  rows = cleaned.map(r=>{
    // T to AE
    const costEx = toNumber(r["Cost Price ex VAT"]);              // T
    const sellInc = toNumber(r["Selling Price inc VAT"]);         // U
    const sellEx = toNumber(r["Selling Price ex VAT"]);           // V
    const sale = toNumber(r["Sale Price"]);                       // W
    const profitPct = toNumber(r["Calculated Profit % Per Unit"]); // X
    const stockValue = toNumber(r["Stock Value"]);                // Y
    const avail = toNumber(r["Availabile Stock"]);                // Z
    const supplier = toNumber(r["Supplier Stock"]);               // AA
    const onOrder = truthy(r["On Order?"]);                       // AB
    const unitsTy = toNumber(r["Total Sales this Year"]);         // AC
    const unitsLy = toNumber(r["Total Sales Last Year"]);         // AD
    const statusRaw = String(r["Best Seller Status"] ?? "").trim(); // AE
    const status = statusRaw || "Unknown";

    const effectiveSellEx = (Number.isFinite(sale) && sale > 0) ? sale : sellEx;

    const discountPct = (Number.isFinite(sale) && sale > 0 && Number.isFinite(sellEx) && sellEx > 0)
      ? ((sellEx - sale) / sellEx) * 100
      : NaN;

    const revenueTy = (Number.isFinite(unitsTy) && Number.isFinite(effectiveSellEx)) ? unitsTy * effectiveSellEx : NaN;
    const gpPerUnit = (Number.isFinite(effectiveSellEx) && Number.isFinite(costEx)) ? (effectiveSellEx - costEx) : NaN;
    const grossProfitTy = (Number.isFinite(unitsTy) && Number.isFinite(gpPerUnit)) ? unitsTy * gpPerUnit : NaN;

    const weeklyRate = Number.isFinite(unitsTy) && unitsTy > 0 ? (unitsTy / 52) : 0;
    const weeksCover = (Number.isFinite(avail) && weeklyRate > 0) ? (avail / weeklyRate) : NaN;

    return {
      productId: String(r["Product ID"] ?? "").trim(),
      sku: String(r["Product SKU"] ?? "").trim(),
      name: String(r["Product Name"] ?? "").trim(),
      brand: String(r["Brand"] ?? "").trim(),

      status,
      onOrder,

      costEx, sellInc, sellEx, sale, profitPct,
      stockValue, avail, supplier,
      unitsTy, unitsLy,

      effectiveSellEx,
      discountPct,
      revenueTy,
      gpPerUnit,
      grossProfitTy,
      weeksCover
    };
  });

  buildStatusColours();
  populateFilters();
  refresh();
}

function buildStatusColours(){
  const statuses = uniqueSorted(rows.map(r=>r.status));
  statusColour = new Map();
  statuses.forEach((s,i)=> statusColour.set(s, pickColour(i)));
}

/* ========= Filters ========= */
function uniqueSorted(values){
  return [...new Set(values.map(v => String(v ?? "").trim()).filter(v => v !== ""))]
    .sort((a,b)=>a.localeCompare(b));
}

function getFilters(){
  return {
    q: (document.getElementById("q").value || "").trim().toLowerCase(),
    status: document.getElementById("status").value,
    brand: document.getElementById("brand").value,
    onOrder: document.getElementById("onOrder").value,
    mode: document.getElementById("mode").value,
    sort: document.getElementById("sort").value
  };
}

function applyFilters(){
  const f = getFilters();
  let out = rows.filter(r=>{
    if (f.status && r.status !== f.status) return false;
    if (f.brand && r.brand !== f.brand) return false;

    if (f.onOrder){
      const want = f.onOrder === "true";
      if (r.onOrder !== want) return false;
    }

    if (f.q){
      const hay = `${r.sku} ${r.name} ${r.productId}`.toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  });

  out = sortItems(out, f.sort);
  return out;
}

function sortItems(items, mode){
  const safe = (v)=> Number.isFinite(v) ? v : -Infinity;
  const safePos = (v)=> Number.isFinite(v) ? v : Infinity;

  const copy = [...items];

  if (mode === "gpDesc") copy.sort((a,b)=> safe(b.grossProfitTy) - safe(a.grossProfitTy));
  else if (mode === "revDesc") copy.sort((a,b)=> safe(b.revenueTy) - safe(a.revenueTy));
  else if (mode === "unitsDesc") copy.sort((a,b)=> safe(b.unitsTy) - safe(a.unitsTy));
  else if (mode === "stockValueDesc") copy.sort((a,b)=> safe(b.stockValue) - safe(a.stockValue));
  else if (mode === "coverDesc") copy.sort((a,b)=> safe(b.weeksCover) - safe(a.weeksCover));
  else if (mode === "coverAsc") copy.sort((a,b)=> safePos(a.weeksCover) - safePos(b.weeksCover));
  else if (mode === "profitPctDesc") copy.sort((a,b)=> safe(b.profitPct) - safe(a.profitPct));
  else if (mode === "discountDesc") copy.sort((a,b)=> safe(b.discountPct) - safe(a.discountPct));

  return copy;
}

function populateFilters(){
  const statusSel = document.getElementById("status");
  const brandSel = document.getElementById("brand");

  statusSel.length = 1;
  brandSel.length = 1;

  uniqueSorted(rows.map(r=>r.status)).forEach(v=> statusSel.add(new Option(v, v)));
  uniqueSorted(rows.map(r=>r.brand)).forEach(v=> brandSel.add(new Option(v, v)));
}

/* ========= Aggregations ========= */
function statusAgg(items){
  const by = new Map();
  for (const r of items){
    const k = r.status || "Unknown";
    if (!by.has(k)) by.set(k, { status:k, products:0, unitsTy:0, unitsLy:0, revenueTy:0, gpTy:0, stockValue:0 });
    const o = by.get(k);
    o.products += 1;
    o.unitsTy += Number.isFinite(r.unitsTy) ? r.unitsTy : 0;
    o.unitsLy += Number.isFinite(r.unitsLy) ? r.unitsLy : 0;
    o.revenueTy += Number.isFinite(r.revenueTy) ? r.revenueTy : 0;
    o.gpTy += Number.isFinite(r.grossProfitTy) ? r.grossProfitTy : 0;
    o.stockValue += Number.isFinite(r.stockValue) ? r.stockValue : 0;
  }
  return [...by.values()].sort((a,b)=> b.revenueTy - a.revenueTy);
}

function topNWithOther(rows2, n=10){
  if (rows2.length <= n) return rows2;
  const top = rows2.slice(0, n);
  const rest = rows2.slice(n).reduce((acc,x)=>{
    acc.products += x.products;
    acc.unitsTy += x.unitsTy;
    acc.unitsLy += x.unitsLy;
    acc.revenueTy += x.revenueTy;
    acc.gpTy += x.gpTy;
    acc.stockValue += x.stockValue;
    return acc;
  }, { status:"Other", products:0, unitsTy:0, unitsLy:0, revenueTy:0, gpTy:0, stockValue:0 });
  top.push(rest);
  return top;
}

/* ========= Charts (best signal for T to AE) ========= */
function drawStatusScoreboard(items){
  const agg = topNWithOther(statusAgg(items), 10);

  const labels = agg.map(x=>x.status);
  const colors = labels.map(s=> statusColour.get(s) || "#bbb");

  safePlot("statusScoreboard", [
    {
      type:"bar",
      name:"Revenue (ex VAT)",
      x: labels,
      y: agg.map(x=>x.revenueTy),
      marker: { color: colors, opacity: 0.75 },
      hovertemplate: "%{x}<br>Revenue: £%{y:,.0f}<extra></extra>"
    },
    {
      type:"bar",
      name:"Gross Profit",
      x: labels,
      y: agg.map(x=>x.gpTy),
      marker: { color: colors },
      hovertemplate: "%{x}<br>Gross profit: £%{y:,.0f}<extra></extra>"
    }
  ], {
    title: "Status Scoreboard",
    barmode: "group",
    xaxis: { automargin:true },
    yaxis: { title: "£" }
  });
}

function drawUnitsTyLyByStatus(items){
  const agg = topNWithOther(statusAgg(items), 12);
  const labels = agg.map(x=>x.status);
  const colors = labels.map(s=> statusColour.get(s) || "#bbb");

  safePlot("unitsTyLyByStatus", [
    {
      type:"bar",
      name:"This Year",
      x: labels,
      y: agg.map(x=>x.unitsTy),
      marker: { color: colors, opacity: 0.80 },
      hovertemplate: "%{x}<br>Units TY: %{y:,.0f}<extra></extra>"
    },
    {
      type:"bar",
      name:"Last Year",
      x: labels,
      y: agg.map(x=>x.unitsLy),
      marker: { color: colors, opacity: 0.45 },
      hovertemplate: "%{x}<br>Units LY: %{y:,.0f}<extra></extra>"
    }
  ], {
    title: "TY vs LY Units by Status",
    barmode: "group",
    xaxis: { automargin:true },
    yaxis: { title: "Units" }
  });
}

function drawSalesVsStock(items){
  const x = [];
  const y = [];
  const size = [];
  const colour = [];
  const text = [];

  for (const r of items){
    const units = Number.isFinite(r.unitsTy) ? r.unitsTy : 0;
    const sv = Number.isFinite(r.stockValue) ? r.stockValue : NaN;
    if (!Number.isFinite(sv)) continue;

    x.push(units);
    y.push(sv);

    const a = Number.isFinite(r.avail) ? r.avail : 0;
    size.push(clamp(Math.sqrt(a) * 5, 7, 50));

    colour.push(statusColour.get(r.status) || "#bbb");

    text.push(
      `${r.sku} | ${r.name}` +
      `<br>Status: ${r.status}` +
      `<br>Units TY: ${fmtInt(r.unitsTy)}` +
      `<br>Revenue TY: ${fmtGBP(r.revenueTy)}` +
      `<br>Gross Profit TY: ${fmtGBP(r.grossProfitTy)}` +
      `<br>Stock Value: ${fmtGBP(r.stockValue)}` +
      `<br>Available: ${fmtInt(r.avail)} Supplier: ${fmtInt(r.supplier)}` +
      `<br>On order: ${r.onOrder ? "Yes" : "No"}`
    );
  }

  safePlot("salesVsStock", [{
    type:"scatter",
    mode:"markers",
    x, y,
    text,
    hoverinfo:"text",
    marker:{ size, color: colour, opacity: 0.72 }
  }], {
    title: "Sales vs Stock Value by Status",
    xaxis: { title: "Units sold (TY)", rangemode:"tozero" },
    yaxis: { title: "Stock value (£)", rangemode:"tozero" }
  });
}

function drawCoverByStatus(items){
  const statuses = uniqueSorted(items.map(r=>r.status));
  const traces = [];

  statuses.forEach((s,i)=>{
    const vals = items
      .filter(r=>r.status===s)
      .map(r=>r.weeksCover)
      .filter(v=>Number.isFinite(v) && v >= 0 && v <= 260);

    if (vals.length === 0) return;

    traces.push({
      type:"box",
      name:s,
      y: vals,
      boxpoints: false,
      marker: { color: statusColour.get(s) || pickColour(i) }
    });
  });

  safePlot("coverByStatus", traces, {
    title: "Weeks of Cover by Status",
    yaxis: { title: "Weeks of cover (capped at 260)", rangemode:"tozero" }
  });
}

function drawProfitPctByStatus(items){
  const statuses = uniqueSorted(items.map(r=>r.status));
  const traces = [];

  statuses.forEach((s,i)=>{
    const vals = items
      .filter(r=>r.status===s)
      .map(r=>r.profitPct)
      .filter(v=>Number.isFinite(v));

    if (vals.length === 0) return;

    traces.push({
      type:"box",
      name:s,
      y: vals,
      boxpoints: false,
      marker: { color: statusColour.get(s) || pickColour(i) }
    });
  });

  safePlot("profitPctByStatus", traces, {
    title: "Profit % by Status",
    yaxis: { title: "Profit % per unit", rangemode:"tozero" }
  });
}

function drawDiscountByStatus(items){
  const statuses = uniqueSorted(items.map(r=>r.status));
  const traces = [];

  statuses.forEach((s,i)=>{
    const vals = items
      .filter(r=>r.status===s)
      .map(r=>r.discountPct)
      .filter(v=>Number.isFinite(v) && v >= -200 && v <= 200);

    if (vals.length === 0) return;

    traces.push({
      type:"violin",
      name:s,
      y: vals,
      points: false,
      meanline: { visible: true },
      line: { color: statusColour.get(s) || pickColour(i) },
      fillcolor: statusColour.get(s) || pickColour(i),
      opacity: 0.65
    });
  });

  safePlot("discountByStatus", traces, {
    title: "Discount Depth by Status",
    yaxis: { title: "Discount %", zeroline:true }
  });
}

/* ========= KPIs ========= */
function renderKpis(items){
  const products = items.length;
  const unitsTy = sum(items.map(r=>r.unitsTy));
  const unitsLy = sum(items.map(r=>r.unitsLy));
  const revenueTy = sum(items.map(r=>r.revenueTy));
  const gpTy = sum(items.map(r=>r.grossProfitTy));
  const stockValue = sum(items.map(r=>r.stockValue));

  document.getElementById("kpiProducts").textContent = products.toLocaleString("en-GB");
  document.getElementById("kpiUnits").textContent = fmtInt(unitsTy);
  document.getElementById("kpiRevenue").textContent = fmtGBP(revenueTy);
  document.getElementById("kpiGP").textContent = fmtGBP(gpTy);
  document.getElementById("kpiStockValue").textContent = fmtGBP(stockValue);

  const labelUnits = document.getElementById("kpiUnitsLabel");
  if (labelUnits) labelUnits.textContent = "Units (This Year)";

  const top = statusAgg(items)[0];
  document.getElementById("kpiTopStatus").textContent = top ? `${top.status}` : "–";

  const mode = document.getElementById("mode").value;
  const revLabel = document.getElementById("kpiRevenueLabel");
  if (revLabel){
    revLabel.textContent = mode === "ly" ? "Estimated Revenue (ex VAT) is TY-only" : "Estimated Revenue (ex VAT)";
  }

  // mode affects units KPI display only (revenue/gp are TY-only because we do not have LY prices)
  if (mode === "ly"){
    document.getElementById("kpiUnits").textContent = fmtInt(unitsLy);
    if (labelUnits) labelUnits.textContent = "Units (Last Year)";
  }
}

/* ========= Table ========= */
function badgeHTML(status){
  const c = statusColour.get(status) || "#bbb";
  const safe = (status || "Unknown").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return `<span class="badge"><span class="dot" style="background:${c}"></span>${safe}</span>`;
}

function renderTable(items){
  const tbody = document.querySelector("#tbl tbody");
  tbody.innerHTML = "";

  const limit = 1000;
  const shown = items.slice(0, limit);

  for (const r of shown){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${badgeHTML(r.status)}</td>
      <td>${r.sku}</td>
      <td>${r.name}</td>
      <td>${r.brand}</td>
      <td>${fmtGBP(r.costEx)}</td>
      <td>${fmtGBP(r.sellEx)}</td>
      <td>${Number.isFinite(r.sale) && r.sale > 0 ? fmtGBP(r.sale) : "–"}</td>
      <td>${fmtPct(r.discountPct)}</td>
      <td>${fmtPct(r.profitPct)}</td>
      <td>${fmtInt(r.unitsTy)}</td>
      <td>${fmtInt(r.unitsLy)}</td>
      <td>${fmtGBP(r.revenueTy)}</td>
      <td>${fmtGBP(r.grossProfitTy)}</td>
      <td>${fmtGBP(r.stockValue)}</td>
      <td>${fmtInt(r.avail)}</td>
      <td>${fmtInt(r.supplier)}</td>
      <td>${r.onOrder ? "Yes" : "No"}</td>
      <td>${Number.isFinite(r.weeksCover) ? r.weeksCover.toFixed(1) : "–"}</td>
    `;
    tbody.appendChild(tr);
  }

  document.getElementById("tableMeta").textContent =
    `Showing ${shown.length.toLocaleString("en-GB")} of ${items.length.toLocaleString("en-GB")} matching SKUs`;
}

/* ========= Refresh ========= */
function refresh(){
  const f = getFilters();
  const items = applyFilters();

  // Mode: ytd vs ly affects "units" axis of charts that rely on units
  const useLyUnits = f.mode === "ly";

  // If LY mode, we swap units used for the unit-based charts
  const itemsForUnitCharts = useLyUnits
    ? items.map(r => ({ ...r, unitsTy: r.unitsLy })) // treat LY as the active "units" for unit visuals
    : items;

  renderKpis(items);

  drawStatusScoreboard(items);              // revenue/gp are TY only, still useful
  drawUnitsTyLyByStatus(items);             // explicitly compares TY and LY

  drawSalesVsStock(itemsForUnitCharts);     // swaps units axis when LY selected
  drawCoverByStatus(items);                 // cover is TY-only (units TY) by definition here
  drawProfitPctByStatus(items);
  drawDiscountByStatus(items);

  renderTable(items);
}

/* ========= Events ========= */
function resetFilters(){
  document.getElementById("q").value = "";
  document.getElementById("status").value = "";
  document.getElementById("brand").value = "";
  document.getElementById("onOrder").value = "";
  document.getElementById("mode").value = "ytd";
  document.getElementById("sort").value = "gpDesc";
  refresh();
}

function bind(){
  document.getElementById("file").addEventListener("change", e=>{
    const f = e.target.files?.[0];
    if (f) loadFromFile(f).catch(console.error);
  });

  document.getElementById("reset").addEventListener("click", resetFilters);

  ["q","status","brand","onOrder","mode","sort"].forEach(id=>{
    document.getElementById(id).addEventListener("input", debounce(refresh, 140));
  });
}

/* ========= Boot ========= */
window.addEventListener("DOMContentLoaded", ()=>{
  bind();
  loadFromPath(BUILT_IN_CSV).catch(err => console.error("Auto load failed:", err));
});
