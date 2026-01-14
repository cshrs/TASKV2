/* ========= Configuration ========= */
const BUILT_IN_CSV = "MakitaExport.csv";

/* ========= Plotly theme ========= */
const baseLayout = {
  paper_bgcolor: "rgba(255,255,255,0)",
  plot_bgcolor: "rgba(255,255,255,0)",
  font: { family: "Inter, system-ui, Segoe UI, Arial, sans-serif", color: "#1f2530" },
  margin: { t: 56, l: 64, r: 18, b: 60 }
};

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
function uniqueSorted(values){
  return [...new Set(values.map(v => String(v ?? "").trim()).filter(v => v !== ""))]
    .sort((a,b)=>a.localeCompare(b));
}

/* ========= Colours ========= */
const BRAND_PALETTE = ["#6aa6ff","#ff9fb3","#90e0c5","#ffd08a","#c9b6ff","#8fd3ff","#ffc6a8","#b2e1a1","#f5b3ff","#a4b0ff"];
const STATUS_PALETTE = ["#c9b6ff","#ffd08a","#90e0c5","#ff9fb3","#6aa6ff","#b2e1a1","#8fd3ff","#ffc6a8"];

let brandColour = new Map();
let statusColour = new Map();
function buildColourMaps(items){
  const brands = uniqueSorted(items.map(r=>r.brand || "Unknown"));
  brandColour = new Map(brands.map((b,i)=>[b, BRAND_PALETTE[i % BRAND_PALETTE.length]]));

  const statuses = uniqueSorted(items.map(r=>r.status || "Unknown"));
  statusColour = new Map(statuses.map((s,i)=>[s, STATUS_PALETTE[i % STATUS_PALETTE.length]]));
}

/* ========= State ========= */
let rows = [];

/* ========= CSV loading ========= */
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

/* ========= Hydrate ========= */
function hydrate(rawRows){
  const nonEmpty = (rawRows || []).filter(r => Object.values(r).some(v => String(v ?? "").trim() !== ""));

  rows = nonEmpty.map(r=>{
    const costEx = toNumber(r["Cost Price ex VAT"]);
    const sellEx = toNumber(r["Selling Price ex VAT"]);
    const sale = toNumber(r["Sale Price"]);
    const profitPct = toNumber(r["Calculated Profit % Per Unit"]);
    const stockValue = toNumber(r["Stock Value"]);
    const avail = toNumber(r["Availabile Stock"]);
    const supplier = toNumber(r["Supplier Stock"]);
    const onOrder = truthy(r["On Order?"]);
    const unitsTy = toNumber(r["Total Sales this Year"]);
    const unitsLy = toNumber(r["Total Sales Last Year"]);
    const status = String(r["Best Seller Status"] ?? "").trim() || "Unknown";

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
      parent: String(r["Parent Category"] ?? "").trim(),
      status,
      onOrder,

      costEx, sellEx, sale, profitPct,
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

  buildColourMaps(rows);
  populateFilters();
  refresh();
}

/* ========= Filters ========= */
function getFilters(){
  return {
    q: (document.getElementById("q").value || "").trim().toLowerCase(),
    brand: document.getElementById("brand").value,
    parent: document.getElementById("parent").value,
    status: document.getElementById("status").value,
    onOrder: document.getElementById("onOrder").value,
    unitsMode: document.getElementById("unitsMode").value,
    sort: document.getElementById("sort").value
  };
}

function applyFilters(){
  const f = getFilters();
  let out = rows.filter(r=>{
    if (f.brand && r.brand !== f.brand) return false;
    if (f.parent && r.parent !== f.parent) return false;
    if (f.status && r.status !== f.status) return false;

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
  else if (mode === "unitsTyDesc") copy.sort((a,b)=> safe(b.unitsTy) - safe(a.unitsTy));
  else if (mode === "unitsLyDesc") copy.sort((a,b)=> safe(b.unitsLy) - safe(a.unitsLy));
  else if (mode === "stockValueDesc") copy.sort((a,b)=> safe(b.stockValue) - safe(a.stockValue));
  else if (mode === "coverDesc") copy.sort((a,b)=> safe(b.weeksCover) - safe(a.weeksCover));
  else if (mode === "coverAsc") copy.sort((a,b)=> safePos(a.weeksCover) - safePos(b.weeksCover));
  else if (mode === "profitPctDesc") copy.sort((a,b)=> safe(b.profitPct) - safe(a.profitPct));
  else if (mode === "discountDesc") copy.sort((a,b)=> safe(b.discountPct) - safe(a.discountPct));

  return copy;
}

function populateFilters(){
  const brandSel = document.getElementById("brand");
  const parentSel = document.getElementById("parent");
  const statusSel = document.getElementById("status");

  brandSel.length = 1;
  parentSel.length = 1;
  statusSel.length = 1;

  uniqueSorted(rows.map(r=>r.brand)).forEach(v=> brandSel.add(new Option(v, v)));
  uniqueSorted(rows.map(r=>r.parent)).forEach(v=> parentSel.add(new Option(v, v)));
  uniqueSorted(rows.map(r=>r.status)).forEach(v=> statusSel.add(new Option(v, v)));
}

/* ========= Aggregations ========= */
function aggByBrand(items){
  const m = new Map();
  for (const r of items){
    const k = r.brand || "Unknown";
    if (!m.has(k)) m.set(k, { k, unitsTy:0, unitsLy:0, rev:0, gp:0 });
    const o = m.get(k);
    o.unitsTy += Number.isFinite(r.unitsTy) ? r.unitsTy : 0;
    o.unitsLy += Number.isFinite(r.unitsLy) ? r.unitsLy : 0;
    o.rev += Number.isFinite(r.revenueTy) ? r.revenueTy : 0;
    o.gp += Number.isFinite(r.grossProfitTy) ? r.grossProfitTy : 0;
  }
  return [...m.values()].sort((a,b)=> b.rev - a.rev);
}

function aggByStatusUnits(items){
  const m = new Map();
  for (const r of items){
    const k = r.status || "Unknown";
    if (!m.has(k)) m.set(k, { k, ty:0, ly:0 });
    const o = m.get(k);
    o.ty += Number.isFinite(r.unitsTy) ? r.unitsTy : 0;
    o.ly += Number.isFinite(r.unitsLy) ? r.unitsLy : 0;
  }
  return [...m.values()].sort((a,b)=> b.ty - a.ty);
}

function aggByStatusRevenue(items){
  const m = new Map();
  for (const r of items){
    const k = r.status || "Unknown";
    m.set(k, (m.get(k) || 0) + (Number.isFinite(r.revenueTy) ? r.revenueTy : 0));
  }
  return [...m.entries()].map(([k,v])=>({k,v})).sort((a,b)=> b.v - a.v);
}

function topNWithOtherPairs(rows2, n=10){
  if (rows2.length <= n) return rows2;
  const top = rows2.slice(0,n);
  const rest = rows2.slice(n).reduce((s,x)=> s + x.v, 0);
  top.push({ k:"Other", v:rest });
  return top;
}

/* ========= Charts ========= */
function drawBrandUnitsTyLy(items){
  const rows2 = aggByBrand(items).slice(0,12);
  const labels = rows2.map(x=>x.k);
  const colours = labels.map((b,i)=> brandColour.get(b) || BRAND_PALETTE[i % BRAND_PALETTE.length]);

  safePlot("brandUnitsTyLy", [
    {
      type:"bar",
      name:"Units TY",
      x: labels,
      y: rows2.map(x=>x.unitsTy),
      marker:{ color: colours, opacity: 0.80 },
      hovertemplate:"%{x}<br>Units TY: %{y:,.0f}<extra></extra>"
    },
    {
      type:"bar",
      name:"Units LY",
      x: labels,
      y: rows2.map(x=>x.unitsLy),
      marker:{ color: colours, opacity: 0.45 },
      hovertemplate:"%{x}<br>Units LY: %{y:,.0f}<extra></extra>"
    }
  ], {
    title:"Sales TY vs Sales LY by Brand (Top 12)",
    barmode:"group",
    xaxis:{ automargin:true },
    yaxis:{ title:"Units" }
  });
}

function drawBrandRevGp(items){
  const rows2 = aggByBrand(items).slice(0,12);
  const labels = rows2.map(x=>x.k);
  const colours = labels.map((b,i)=> brandColour.get(b) || BRAND_PALETTE[i % BRAND_PALETTE.length]);

  safePlot("brandRevGp", [
    {
      type:"bar",
      name:"Revenue TY (ex VAT)",
      x: labels,
      y: rows2.map(x=>x.rev),
      marker:{ color: colours, opacity: 0.75 },
      hovertemplate:"%{x}<br>Revenue: £%{y:,.0f}<extra></extra>"
    },
    {
      type:"bar",
      name:"Gross Profit TY",
      x: labels,
      y: rows2.map(x=>x.gp),
      marker:{ color: colours },
      hovertemplate:"%{x}<br>Gross profit: £%{y:,.0f}<extra></extra>"
    }
  ], {
    title:"Revenue TY and Gross Profit TY by Brand (Top 12)",
    barmode:"group",
    xaxis:{ automargin:true },
    yaxis:{ title:"£" }
  });
}

function drawStockVsUnits(items){
  const mode = document.getElementById("unitsMode").value;

  const x = [];
  const y = [];
  const size = [];
  const colour = [];
  const text = [];

  for (const r of items){
    const units = mode === "ly" ? r.unitsLy : r.unitsTy;
    const sv = r.stockValue;
    if (!Number.isFinite(sv)) continue;

    x.push(Number.isFinite(units) ? units : 0);
    y.push(sv);

    const a = Number.isFinite(r.avail) ? r.avail : 0;
    size.push(clamp(Math.sqrt(a) * 5, 7, 52));

    colour.push(brandColour.get(r.brand) || "#bbb");

    text.push(
      `${r.sku} | ${r.name}` +
      `<br>Brand: ${r.brand}` +
      `<br>Status: ${r.status}` +
      `<br>Units TY: ${fmtInt(r.unitsTy)} Units LY: ${fmtInt(r.unitsLy)}` +
      `<br>Revenue TY: ${fmtGBP(r.revenueTy)}` +
      `<br>GP TY: ${fmtGBP(r.grossProfitTy)}` +
      `<br>Stock Value: ${fmtGBP(r.stockValue)}` +
      `<br>Available: ${fmtInt(r.avail)} Supplier: ${fmtInt(r.supplier)} On order: ${r.onOrder ? "Yes" : "No"}`
    );
  }

  safePlot("stockVsUnits", [{
    type:"scatter",
    mode:"markers",
    x, y,
    text,
    hoverinfo:"text",
    marker:{ size, color: colour, opacity: 0.72 }
  }], {
    title:"Stock Value vs Units (Bubble: Available Stock)",
    xaxis:{ title: mode === "ly" ? "Units (Last Year)" : "Units (This Year)", rangemode:"tozero" },
    yaxis:{ title:"Stock Value (£)", rangemode:"tozero" }
  });
}

function drawCoverHist(items){
  const vals = items
    .map(r=>r.weeksCover)
    .filter(v=>Number.isFinite(v) && v >= 0 && v <= 260);

  safePlot("coverHist", [{
    type:"histogram",
    x: vals,
    nbinsx: 40,
    hovertemplate:"Weeks cover: %{x:.1f}<extra></extra>"
  }], {
    title:"Weeks of Cover Distribution",
    xaxis:{ title:"Weeks of cover (capped at 260)" },
    yaxis:{ title:"SKUs" }
  });
}

function drawDiscountVsProfit(items){
  const x = [];
  const y = [];
  const colour = [];
  const text = [];

  for (const r of items){
    if (!Number.isFinite(r.discountPct)) continue;
    if (!Number.isFinite(r.profitPct)) continue;

    x.push(r.discountPct);
    y.push(r.profitPct);
    colour.push(statusColour.get(r.status) || "#bbb");

    text.push(
      `${r.sku} | ${r.name}` +
      `<br>Status: ${r.status}` +
      `<br>Discount: ${fmtPct(r.discountPct)}` +
      `<br>Profit %: ${fmtPct(r.profitPct)}` +
      `<br>Sell ex VAT: ${fmtGBP(r.sellEx)} Sale: ${Number.isFinite(r.sale) && r.sale > 0 ? fmtGBP(r.sale) : "–"}`
    );
  }

  safePlot("discountVsProfit", [{
    type:"scatter",
    mode:"markers",
    x, y,
    text,
    hoverinfo:"text",
    marker:{ color: colour, opacity: 0.70 }
  }], {
    title:"Discount vs Profit % (Colour: Status)",
    xaxis:{ title:"Discount %", zeroline:true },
    yaxis:{ title:"Profit % per unit", rangemode:"tozero" }
  });
}

function drawStatusShare(items){
  const rows2 = topNWithOtherPairs(aggByStatusRevenue(items), 10);
  safePlot("statusShare", [{
    type:"pie",
    labels: rows2.map(x=>x.k),
    values: rows2.map(x=>x.v),
    hole: 0.45,
    textinfo:"label+percent",
    marker:{ colors: rows2.map(x=> statusColour.get(x.k) || "#bbb") }
  }], {
    title:"Status Share (Revenue TY)"
  });
}

function drawStatusUnitsTyLy(items){
  const rows2 = aggByStatusUnits(items).slice(0,12);
  const labels = rows2.map(x=>x.k);
  const colours = labels.map(s=> statusColour.get(s) || "#bbb");

  safePlot("statusUnitsTyLy", [
    { type:"bar", name:"Units TY", x:labels, y:rows2.map(x=>x.ty), marker:{ color: colours, opacity: 0.80 } },
    { type:"bar", name:"Units LY", x:labels, y:rows2.map(x=>x.ly), marker:{ color: colours, opacity: 0.45 } }
  ], {
    title:"TY vs LY Units by Status (Top 12)",
    barmode:"group",
    xaxis:{ automargin:true },
    yaxis:{ title:"Units" }
  });
}

function drawTopSkuGP(items){
  const top = items
    .map(r=>({ label: `${r.sku} | ${r.name}`.slice(0, 70), v: r.grossProfitTy, brand: r.brand }))
    .filter(x=>Number.isFinite(x.v) && x.v > 0)
    .sort((a,b)=> b.v - a.v)
    .slice(0, 20);

  safePlot("topSkuGP", [{
    type:"bar",
    x: top.map(t=>t.label),
    y: top.map(t=>t.v),
    marker:{ color: top.map((t,i)=> brandColour.get(t.brand) || BRAND_PALETTE[i % BRAND_PALETTE.length]) },
    hovertemplate:"£%{y:,.0f}<extra></extra>"
  }], {
    title:"Top SKUs by Gross Profit TY (Top 20)",
    xaxis:{ automargin:true, showticklabels:false },
    yaxis:{ title:"£" }
  });
}

/* ========= KPIs + table ========= */
function renderKpis(items){
  document.getElementById("kpiProducts").textContent = items.length.toLocaleString("en-GB");

  const unitsTy = sum(items.map(r=>r.unitsTy));
  const unitsLy = sum(items.map(r=>r.unitsLy));
  const revTy = sum(items.map(r=>r.revenueTy));
  const gpTy = sum(items.map(r=>r.grossProfitTy));
  const stockValue = sum(items.map(r=>r.stockValue));

  document.getElementById("kpiUnitsTy").textContent = fmtInt(unitsTy);
  document.getElementById("kpiUnitsLy").textContent = fmtInt(unitsLy);
  document.getElementById("kpiRevenueTy").textContent = fmtGBP(revTy);
  document.getElementById("kpiGPTY").textContent = fmtGBP(gpTy);
  document.getElementById("kpiStockValue").textContent = fmtGBP(stockValue);
}

function renderTable(items){
  const tbody = document.querySelector("#tbl tbody");
  tbody.innerHTML = "";

  const limit = 1000;
  const shown = items.slice(0, limit);

  for (const r of shown){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.sku}</td>
      <td>${r.name}</td>
      <td>${r.brand}</td>
      <td>${r.parent}</td>
      <td>${r.status}</td>
      <td>${fmtInt(r.unitsTy)}</td>
      <td>${fmtInt(r.unitsLy)}</td>
      <td>${fmtGBP(r.revenueTy)}</td>
      <td>${fmtGBP(r.grossProfitTy)}</td>
      <td>${fmtGBP(r.costEx)}</td>
      <td>${fmtGBP(r.sellEx)}</td>
      <td>${Number.isFinite(r.sale) && r.sale > 0 ? fmtGBP(r.sale) : "–"}</td>
      <td>${fmtPct(r.discountPct)}</td>
      <td>${fmtPct(r.profitPct)}</td>
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
  const items = applyFilters();

  renderKpis(items);

  drawBrandUnitsTyLy(items);
  drawBrandRevGp(items);
  drawStockVsUnits(items);
  drawCoverHist(items);

  drawDiscountVsProfit(items);
  drawStatusShare(items);
  drawStatusUnitsTyLy(items);

  drawTopSkuGP(items);

  renderTable(items);
}

/* ========= Events ========= */
function resetFilters(){
  document.getElementById("q").value = "";
  document.getElementById("brand").value = "";
  document.getElementById("parent").value = "";
  document.getElementById("status").value = "";
  document.getElementById("onOrder").value = "";
  document.getElementById("unitsMode").value = "ty";
  document.getElementById("sort").value = "gpDesc";
  refresh();
}

function bind(){
  document.getElementById("file").addEventListener("change", e=>{
    const f = e.target.files?.[0];
    if (f) loadFromFile(f).catch(console.error);
  });

  document.getElementById("reset").addEventListener("click", resetFilters);

  ["q","brand","parent","status","onOrder","unitsMode","sort"].forEach(id=>{
    document.getElementById(id).addEventListener("input", debounce(refresh, 140));
  });
}

/* ========= Boot ========= */
window.addEventListener("DOMContentLoaded", ()=>{
  bind();
  loadFromPath(BUILT_IN_CSV).catch(err => console.error("Auto load failed:", err));
});
