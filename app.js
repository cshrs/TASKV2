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
const debounce = (fn,ms=160)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

function chartHeight(id){
  return document.getElementById(id)?.clientHeight || 460;
}
function safePlot(id, traces, layout, config){
  Plotly.newPlot(
    id,
    traces,
    { ...baseLayout, ...layout, height: chartHeight(id) },
    { responsive: true, displaylogo: false, ...config }
  );
}
function uniqueSorted(values){
  return [...new Set(values.map(v => String(v ?? "").trim()).filter(v => v !== ""))]
    .sort((a,b)=>a.localeCompare(b));
}

/* ========= Colours ========= */
const BRAND_PALETTE = ["#6aa6ff","#ff9fb3","#90e0c5","#ffd08a","#c9b6ff","#8fd3ff","#ffc6a8","#b2e1a1","#f5b3ff","#a4b0ff"];

/* Status colours: consistent and legible pastel tags */
const STATUS_COLOURS = {
  "Best Seller": "#90e0c5",
  "Core": "#6aa6ff",
  "Seasonal": "#ffd08a",
  "New": "#c9b6ff",
  "Slow": "#ff9fb3",
  "Discontinued": "#a4b0ff",
  "Unknown": "#cbd5e1"
};
const STATUS_FALLBACK = ["#90e0c5","#6aa6ff","#ffd08a","#c9b6ff","#ff9fb3","#b2e1a1","#8fd3ff","#ffc6a8","#a4b0ff"];

let brandColour = new Map();
let statusColour = new Map();

function normaliseKey(s){
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g," ");
}

function buildColourMaps(items){
  const brands = uniqueSorted(items.map(r=>r.brand || "Unknown"));
  brandColour = new Map(brands.map((b,i)=>[b, BRAND_PALETTE[i % BRAND_PALETTE.length]]));

  const statuses = uniqueSorted(items.map(r=>r.status || "Unknown"));
  const pairs = [];
  let i = 0;
  for (const st of statuses){
    const k = normaliseKey(st);
    const exact = STATUS_COLOURS[st] || STATUS_COLOURS[k] || null;
    pairs.push([st, exact || STATUS_FALLBACK[i++ % STATUS_FALLBACK.length]]);
  }
  statusColour = new Map(pairs);
}

function hexToRgba(hex, alpha){
  const h = String(hex || "").replace("#","");
  if (h.length !== 6) return `rgba(203,213,225,${alpha})`;
  const r = parseInt(h.slice(0,2),16);
  const g = parseInt(h.slice(2,4),16);
  const b = parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function statusPillHTML(status){
  const col = statusColour.get(status) || "#cbd5e1";
  const bg = hexToRgba(col, 0.22);
  return `<span class="pill" style="background:${bg};">
    <span class="pill-dot" style="background:${col};"></span>
    ${status}
  </span>`;
}

function brandPillHTML(brand){
  const col = brandColour.get(brand) || "#cbd5e1";
  const bg = hexToRgba(col, 0.18);
  return `<span class="pill" style="background:${bg};">
    <span class="pill-dot" style="background:${col};"></span>
    ${brand}
  </span>`;
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
    const avail = toNumber(r["Availabile Stock"]);
    const supplier = toNumber(r["Supplier Stock"]);
    const onOrder = truthy(r["On Order?"]);
    const unitsThisYear = toNumber(r["Total Sales this Year"]);
    const unitsLastYear = toNumber(r["Total Sales Last Year"]);
    const status = String(r["Best Seller Status"] ?? "").trim() || "Unknown";

    /* sale-aware basis */
    const effectiveSellEx = (Number.isFinite(sale) && sale > 0) ? sale : sellEx;
    const revenueSaleAware = (Number.isFinite(unitsThisYear) && Number.isFinite(effectiveSellEx)) ? unitsThisYear * effectiveSellEx : NaN;
    const gpPerUnitSaleAware = (Number.isFinite(effectiveSellEx) && Number.isFinite(costEx)) ? (effectiveSellEx - costEx) : NaN;
    const grossProfitSaleAware = (Number.isFinite(unitsThisYear) && Number.isFinite(gpPerUnitSaleAware)) ? unitsThisYear * gpPerUnitSaleAware : NaN;

    /* selling price basis (explicit request) */
    const revenueSelling = (Number.isFinite(unitsThisYear) && Number.isFinite(sellEx)) ? unitsThisYear * sellEx : NaN;
    const profitPerUnitSelling = (Number.isFinite(sellEx) && Number.isFinite(costEx)) ? (sellEx - costEx) : NaN;
    const profitSelling = (Number.isFinite(unitsThisYear) && Number.isFinite(profitPerUnitSelling)) ? unitsThisYear * profitPerUnitSelling : NaN;

    const discountPct = (Number.isFinite(sale) && sale > 0 && Number.isFinite(sellEx) && sellEx > 0)
      ? ((sellEx - sale) / sellEx) * 100
      : NaN;

    return {
      productId: String(r["Product ID"] ?? "").trim(),
      sku: String(r["Product SKU"] ?? "").trim(),
      name: String(r["Product Name"] ?? "").trim(),

      brand: String(r["Brand"] ?? "").trim() || "Unknown",
      parent: String(r["Parent Category"] ?? "").trim() || "Unknown",
      status,
      onOrder,

      costEx, sellEx, sale, profitPct,
      avail, supplier,
      unitsThisYear, unitsLastYear,

      effectiveSellEx,
      discountPct,

      revenueSaleAware,
      grossProfitSaleAware,

      revenueSelling,
      profitSelling
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
    sort: document.getElementById("sort").value,

    tableQ: (document.getElementById("tableSearch").value || "").trim().toLowerCase(),
    onlySelling: document.getElementById("onlySelling").checked
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

function applyTableFilters(items){
  const f = getFilters();
  let out = items;

  if (f.onlySelling) out = out.filter(r => Number.isFinite(r.unitsThisYear) && r.unitsThisYear > 0);

  if (f.tableQ){
    out = out.filter(r => (`${r.sku} ${r.name} ${r.productId}`.toLowerCase().includes(f.tableQ)));
  }
  return out;
}

function sortItems(items, mode){
  const safe = (v)=> Number.isFinite(v) ? v : -Infinity;

  const copy = [...items];

  if (mode === "gpEffDesc") copy.sort((a,b)=> safe(b.grossProfitSaleAware) - safe(a.grossProfitSaleAware));
  else if (mode === "revEffDesc") copy.sort((a,b)=> safe(b.revenueSaleAware) - safe(a.revenueSaleAware));
  else if (mode === "revSellDesc") copy.sort((a,b)=> safe(b.revenueSelling) - safe(a.revenueSelling));
  else if (mode === "gpSellDesc") copy.sort((a,b)=> safe(b.profitSelling) - safe(a.profitSelling));
  else if (mode === "unitsThisYearDesc") copy.sort((a,b)=> safe(b.unitsThisYear) - safe(a.unitsThisYear));
  else if (mode === "unitsLastYearDesc") copy.sort((a,b)=> safe(b.unitsLastYear) - safe(a.unitsLastYear));
  else if (mode === "profitPctDesc") copy.sort((a,b)=> safe(b.profitPct) - safe(a.profitPct));
  else if (mode === "discountDesc") copy.sort((a,b)=> safe(b.discountPct) - safe(a.discountPct));

  return copy;
}

function populateFilters(){
  const remember = {
    brand: document.getElementById("brand").value,
    parent: document.getElementById("parent").value,
    status: document.getElementById("status").value
  };

  const brandSel = document.getElementById("brand");
  const parentSel = document.getElementById("parent");
  const statusSel = document.getElementById("status");

  brandSel.length = 1;
  parentSel.length = 1;
  statusSel.length = 1;

  uniqueSorted(rows.map(r=>r.brand)).forEach(v=> brandSel.add(new Option(v, v)));
  uniqueSorted(rows.map(r=>r.parent)).forEach(v=> parentSel.add(new Option(v, v)));
  uniqueSorted(rows.map(r=>r.status)).forEach(v=> statusSel.add(new Option(v, v)));

  if (remember.brand) brandSel.value = remember.brand;
  if (remember.parent) parentSel.value = remember.parent;
  if (remember.status) statusSel.value = remember.status;
}

/* ========= Aggregations ========= */
function aggByBrand(items){
  const m = new Map();
  for (const r of items){
    const k = r.brand || "Unknown";
    if (!m.has(k)) m.set(k, {
      k,
      unitsThisYear:0,
      unitsLastYear:0,
      revSaleAware:0,
      gpSaleAware:0,
      revSelling:0,
      profitSelling:0
    });
    const o = m.get(k);

    o.unitsThisYear += Number.isFinite(r.unitsThisYear) ? r.unitsThisYear : 0;
    o.unitsLastYear += Number.isFinite(r.unitsLastYear) ? r.unitsLastYear : 0;

    o.revSaleAware += Number.isFinite(r.revenueSaleAware) ? r.revenueSaleAware : 0;
    o.gpSaleAware += Number.isFinite(r.grossProfitSaleAware) ? r.grossProfitSaleAware : 0;

    o.revSelling += Number.isFinite(r.revenueSelling) ? r.revenueSelling : 0;
    o.profitSelling += Number.isFinite(r.profitSelling) ? r.profitSelling : 0;
  }
  return [...m.values()].sort((a,b)=> b.revSaleAware - a.revSaleAware);
}

function aggByStatusUnits(items){
  const m = new Map();
  for (const r of items){
    const k = r.status || "Unknown";
    if (!m.has(k)) m.set(k, { k, thisYear:0, lastYear:0 });
    const o = m.get(k);
    o.thisYear += Number.isFinite(r.unitsThisYear) ? r.unitsThisYear : 0;
    o.lastYear += Number.isFinite(r.unitsLastYear) ? r.unitsLastYear : 0;
  }
  return [...m.values()].sort((a,b)=> b.thisYear - a.thisYear);
}

function aggByStatusRevenue(items){
  const m = new Map();
  for (const r of items){
    const k = r.status || "Unknown";
    m.set(k, (m.get(k) || 0) + (Number.isFinite(r.revenueSaleAware) ? r.revenueSaleAware : 0));
  }
  return [...m.entries()].map(([k,v])=>({k,v})).sort((a,b)=> b.v - a.v);
}

function aggByParentRevenue(items){
  const m = new Map();
  for (const r of items){
    const k = r.parent || "Unknown";
    m.set(k, (m.get(k) || 0) + (Number.isFinite(r.revenueSaleAware) ? r.revenueSaleAware : 0));
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
function drawBrandUnitsThisYearLastYear(items){
  const rows2 = aggByBrand(items).slice(0,12);
  const labels = rows2.map(x=>x.k);
  const colours = labels.map((b,i)=> brandColour.get(b) || BRAND_PALETTE[i % BRAND_PALETTE.length]);

  safePlot("brandUnitsThisYearLastYear", [
    {
      type:"bar",
      name:"Units This Year",
      x: labels,
      y: rows2.map(x=>x.unitsThisYear),
      marker:{ color: colours, opacity: 0.82 },
      hovertemplate:"%{x}<br>Units this year: %{y:,.0f}<extra></extra>"
    },
    {
      type:"bar",
      name:"Units Last Year",
      x: labels,
      y: rows2.map(x=>x.unitsLastYear),
      marker:{ color: colours, opacity: 0.45 },
      hovertemplate:"%{x}<br>Units last year: %{y:,.0f}<extra></extra>"
    }
  ], {
    title:"Sales This Year vs Last Year by Brand (Top 12)",
    barmode:"group",
    xaxis:{ automargin:true },
    yaxis:{ title:"Units" }
  });
}

function drawBrandRevProfitSaleAware(items){
  const rows2 = aggByBrand(items).slice(0,12);
  const labels = rows2.map(x=>x.k);
  const colours = labels.map((b,i)=> brandColour.get(b) || BRAND_PALETTE[i % BRAND_PALETTE.length]);

  safePlot("brandRevProfitSaleAware", [
    {
      type:"bar",
      name:"Revenue This Year (sale aware)",
      x: labels,
      y: rows2.map(x=>x.revSaleAware),
      marker:{ color: colours, opacity: 0.72 },
      hovertemplate:"%{x}<br>Revenue: £%{y:,.0f}<extra></extra>"
    },
    {
      type:"bar",
      name:"Gross Profit This Year (sale aware)",
      x: labels,
      y: rows2.map(x=>x.gpSaleAware),
      marker:{ color: colours, opacity: 0.95 },
      hovertemplate:"%{x}<br>Gross profit: £%{y:,.0f}<extra></extra>"
    }
  ], {
    title:"Revenue and Gross Profit This Year by Brand (Top 12, sale aware)",
    barmode:"group",
    xaxis:{ automargin:true },
    yaxis:{ title:"£" }
  });
}

function drawBrandRevProfitSelling(items){
  const rows2 = aggByBrand(items).slice(0,12);
  const labels = rows2.map(x=>x.k);
  const colours = labels.map((b,i)=> brandColour.get(b) || BRAND_PALETTE[i % BRAND_PALETTE.length]);

  safePlot("brandRevProfitSelling", [
    {
      type:"bar",
      name:"Revenue This Year (selling price)",
      x: labels,
      y: rows2.map(x=>x.revSelling),
      marker:{ color: colours, opacity: 0.72 },
      hovertemplate:"%{x}<br>Revenue: £%{y:,.0f}<extra></extra>"
    },
    {
      type:"bar",
      name:"Profit This Year (selling price)",
      x: labels,
      y: rows2.map(x=>x.profitSelling),
      marker:{ color: colours, opacity: 0.95 },
      hovertemplate:"%{x}<br>Profit: £%{y:,.0f}<extra></extra>"
    }
  ], {
    title:"Revenue and Profit This Year by Brand (Top 12, selling price basis)",
    barmode:"group",
    xaxis:{ automargin:true },
    yaxis:{ title:"£" }
  });
}

function drawParentRevenueShare(items){
  const rows2 = topNWithOtherPairs(aggByParentRevenue(items).map(x=>({k:x.k, v:x.v})), 10);
  safePlot("parentRevenueShare", [{
    type:"pie",
    labels: rows2.map(x=>x.k),
    values: rows2.map(x=>x.v),
    hole: 0.45,
    textinfo:"label+percent"
  }], { title:"Parent Category Revenue Share (This Year, sale aware)" });
}

function drawSkuProfitabilityMap(items){
  const colour = [];
  const x = [];
  const y = [];
  const text = [];

  for (const r of items){
    if (!Number.isFinite(r.revenueSaleAware) || !Number.isFinite(r.grossProfitSaleAware)) continue;

    x.push(r.revenueSaleAware);
    y.push(r.grossProfitSaleAware);

    colour.push(brandColour.get(r.brand) || "#cbd5e1");

    text.push(
      `<b>${r.sku}</b><br>${r.name}` +
      `<br>${r.brand} | ${r.parent}` +
      `<br>Status: ${r.status}` +
      `<br>Units this year: ${fmtInt(r.unitsThisYear)} Units last year: ${fmtInt(r.unitsLastYear)}` +
      `<br>Revenue (sale aware): ${fmtGBP(r.revenueSaleAware)}` +
      `<br>Gross profit (sale aware): ${fmtGBP(r.grossProfitSaleAware)}`
    );
  }

  safePlot("skuProfitabilityMap", [{
    type:"scatter",
    mode:"markers",
    x, y,
    text,
    hoverinfo:"text",
    marker:{ size: 9, color: colour, opacity: 0.72 }
  }], {
    title:"SKU Profitability Map (This Year, sale aware)",
    xaxis:{ title:"Revenue This Year (sale aware, £)", rangemode:"tozero" },
    yaxis:{ title:"Gross Profit This Year (sale aware, £)", rangemode:"tozero" }
  });
}

/* easier than discount vs profit scatter: discount bands */
function discountBand(p){
  if (!Number.isFinite(p)) return null;
  if (p < 5) return "0 to 5%";
  if (p < 10) return "5 to 10%";
  if (p < 20) return "10 to 20%";
  if (p < 30) return "20 to 30%";
  if (p < 40) return "30 to 40%";
  return "40%+";
}

function drawDiscountBandsUnits(items){
  const bandsOrder = ["0 to 5%","5 to 10%","10 to 20%","20 to 30%","30 to 40%","40%+"];

  const m = new Map(bandsOrder.map(b=>[b, { band:b, skus:0, units:0 }]));
  for (const r of items){
    const b = discountBand(r.discountPct);
    if (!b) continue;
    const o = m.get(b);
    o.skus += 1;
    o.units += Number.isFinite(r.unitsThisYear) ? r.unitsThisYear : 0;
  }

  const rows2 = bandsOrder.map(b=>m.get(b));
  safePlot("discountBandsUnits", [{
    type:"bar",
    x: rows2.map(x=>x.band),
    y: rows2.map(x=>x.units),
    hovertemplate:"%{x}<br>Units this year: %{y:,.0f}<extra></extra>",
    marker:{ opacity: 0.85 }
  }], {
    title:"Discount Bands vs Units This Year",
    xaxis:{ automargin:true },
    yaxis:{ title:"Units this year" }
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
    marker:{ colors: rows2.map(x=> statusColour.get(x.k) || "#cbd5e1") }
  }], { title:"Status Share (Revenue This Year, sale aware)" });
}

function drawStatusUnitsThisYearLastYear(items){
  const rows2 = aggByStatusUnits(items).slice(0,12);
  const labels = rows2.map(x=>x.k);
  const colours = labels.map(s=> statusColour.get(s) || "#cbd5e1");

  safePlot("statusUnitsThisYearLastYear", [
    { type:"bar", name:"Units This Year", x:labels, y:rows2.map(x=>x.thisYear), marker:{ color: colours, opacity: 0.82 } },
    { type:"bar", name:"Units Last Year", x:labels, y:rows2.map(x=>x.lastYear), marker:{ color: colours, opacity: 0.45 } }
  ], {
    title:"Sales This Year vs Last Year by Status (Top 12)",
    barmode:"group",
    xaxis:{ automargin:true },
    yaxis:{ title:"Units" }
  });
}

/* Shortened labels: axis shows SKU only, hover shows full name and value */
function drawTopSkuGrossProfit(items){
  const top = items
    .filter(r => Number.isFinite(r.grossProfitSaleAware) && r.grossProfitSaleAware > 0)
    .sort((a,b)=> b.grossProfitSaleAware - a.grossProfitSaleAware)
    .slice(0, 30);

  const y = top.map(r => r.sku || "(no sku)");
  const x = top.map(r => r.grossProfitSaleAware);
  const colours = top.map((r,i)=> brandColour.get(r.brand) || BRAND_PALETTE[i % BRAND_PALETTE.length]);

  const hover = top.map(r =>
    `<b>${r.sku}</b><br>${r.name}` +
    `<br>${r.brand} | ${r.parent}` +
    `<br>Status: ${r.status}` +
    `<br>Gross profit (sale aware): ${fmtGBP(r.grossProfitSaleAware)}`
  );

  safePlot("topSkuGrossProfit", [{
    type:"bar",
    orientation:"h",
    y,
    x,
    marker:{ color: colours, opacity: 0.92 },
    text: x.map(v => fmtGBP(v)),
    textposition: "none",
    hovertext: hover,
    hoverinfo: "text"
  }], {
    title:"Top SKUs by Gross Profit This Year (sale aware)",
    xaxis:{ title:"£" },
    yaxis:{ automargin:true },
    margin: { t: 56, l: 180, r: 18, b: 60 }
  });
}

function drawTopSkuRevenueSelling(items){
  const top = items
    .filter(r => Number.isFinite(r.revenueSelling) && r.revenueSelling > 0)
    .sort((a,b)=> b.revenueSelling - a.revenueSelling)
    .slice(0, 30);

  const y = top.map(r => r.sku || "(no sku)");
  const x = top.map(r => r.revenueSelling);
  const colours = top.map((r,i)=> brandColour.get(r.brand) || BRAND_PALETTE[i % BRAND_PALETTE.length]);

  const hover = top.map(r =>
    `<b>${r.sku}</b><br>${r.name}` +
    `<br>${r.brand} | ${r.parent}` +
    `<br>Status: ${r.status}` +
    `<br>Revenue (selling price): ${fmtGBP(r.revenueSelling)}`
  );

  safePlot("topSkuRevenueSelling", [{
    type:"bar",
    orientation:"h",
    y,
    x,
    marker:{ color: colours, opacity: 0.92 },
    hovertext: hover,
    hoverinfo: "text"
  }], {
    title:"Top SKUs by Revenue This Year (selling price basis)",
    xaxis:{ title:"£" },
    yaxis:{ automargin:true },
    margin: { t: 56, l: 180, r: 18, b: 60 }
  });
}

/* ========= KPIs ========= */
function renderKpis(items){
  document.getElementById("kpiProducts").textContent = items.length.toLocaleString("en-GB");

  const unitsThisYear = sum(items.map(r=>r.unitsThisYear));
  const unitsLastYear = sum(items.map(r=>r.unitsLastYear));

  const revSaleAware = sum(items.map(r=>r.revenueSaleAware));
  const gpSaleAware = sum(items.map(r=>r.grossProfitSaleAware));
  const revSelling = sum(items.map(r=>r.revenueSelling));

  document.getElementById("kpiUnitsThisYear").textContent = fmtInt(unitsThisYear);
  document.getElementById("kpiUnitsLastYear").textContent = fmtInt(unitsLastYear);
  document.getElementById("kpiRevenueSaleAware").textContent = fmtGBP(revSaleAware);
  document.getElementById("kpiGrossProfitSaleAware").textContent = fmtGBP(gpSaleAware);
  document.getElementById("kpiRevenueSelling").textContent = fmtGBP(revSelling);

  const statuses = aggByStatusRevenue(items).slice(0, 3);
  const el = document.getElementById("kpiStatusSummary");
  if (el){
    el.innerHTML = statuses.map(s => {
      const col = statusColour.get(s.k) || "#cbd5e1";
      const bg = hexToRgba(col, 0.18);
      return `<span class="pill" style="background:${bg};">
        <span class="pill-dot" style="background:${col};"></span>
        ${s.k}: ${fmtGBP(s.v)}
      </span>`;
    }).join("");
  }
}

/* ========= Table ========= */
function renderTable(items){
  const tbody = document.querySelector("#tbl tbody");
  tbody.innerHTML = "";

  const filtered = applyTableFilters(items);

  const limit = 1400;
  const shown = filtered.slice(0, limit);

  for (const r of shown){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.sku}</td>
      <td>${r.name}</td>
      <td>${brandPillHTML(r.brand)}</td>
      <td>${r.parent}</td>
      <td>${statusPillHTML(r.status)}</td>

      <td>${fmtInt(r.unitsThisYear)}</td>
      <td>${fmtInt(r.unitsLastYear)}</td>

      <td>${fmtGBP(r.revenueSaleAware)}</td>
      <td>${fmtGBP(r.grossProfitSaleAware)}</td>

      <td>${fmtGBP(r.revenueSelling)}</td>
      <td>${fmtGBP(r.profitSelling)}</td>

      <td>${fmtGBP(r.costEx)}</td>
      <td>${fmtGBP(r.sellEx)}</td>
      <td>${Number.isFinite(r.sale) && r.sale > 0 ? fmtGBP(r.sale) : "–"}</td>

      <td>${fmtPct(r.discountPct)}</td>
      <td>${fmtPct(r.profitPct)}</td>

      <td>${fmtInt(r.avail)}</td>
      <td>${fmtInt(r.supplier)}</td>
      <td>${r.onOrder ? "Yes" : "No"}</td>
    `;
    tbody.appendChild(tr);
  }

  const meta = document.getElementById("tableMeta");
  if (meta){
    const more = filtered.length > limit ? ` (showing first ${limit.toLocaleString("en-GB")})` : "";
    meta.textContent = `${filtered.length.toLocaleString("en-GB")} rows in table after table filters${more}`;
  }
}

/* ========= Refresh ========= */
function refresh(){
  const items = applyFilters();

  renderKpis(items);

  drawBrandUnitsThisYearLastYear(items);
  drawBrandRevProfitSaleAware(items);
  drawBrandRevProfitSelling(items);

  drawParentRevenueShare(items);
  drawSkuProfitabilityMap(items);

  drawDiscountBandsUnits(items);

  drawStatusShare(items);
  drawStatusUnitsThisYearLastYear(items);

  drawTopSkuGrossProfit(items);
  drawTopSkuRevenueSelling(items);

  renderTable(items);
}

/* ========= Events ========= */
function resetFilters(){
  document.getElementById("q").value = "";
  document.getElementById("brand").value = "";
  document.getElementById("parent").value = "";
  document.getElementById("status").value = "";
  document.getElementById("onOrder").value = "";
  document.getElementById("unitsMode").value = "thisYear";
  document.getElementById("sort").value = "gpEffDesc";

  document.getElementById("tableSearch").value = "";
  document.getElementById("onlySelling").checked = false;

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

  ["tableSearch","onlySelling"].forEach(id=>{
    document.getElementById(id).addEventListener("input", debounce(refresh, 140));
    document.getElementById(id).addEventListener("change", debounce(refresh, 140));
  });
}

/* ========= Boot ========= */
window.addEventListener("DOMContentLoaded", ()=>{
  bind();
  loadFromPath(BUILT_IN_CSV).catch(err => console.error("Auto load failed:", err));
});
