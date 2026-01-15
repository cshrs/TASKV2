/* ========= Configuration ========= */
const BUILT_IN_CSV = "MakitaExport.csv";

/* ========= Plotly theme ========= */
const baseLayout = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { family: "Inter, system-ui, Segoe UI, Arial, sans-serif", color: "#ece6d5" },
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
function fmtGBP(n){
  return Number.isFinite(n)
    ? new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP"}).format(n)
    : "-";
}
function fmtInt(n){
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-GB") : "-";
}
function fmtPct(n){
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "-";
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

/* ========= Dependent dropdown helpers ========= */
function setSelectOptions(selectEl, values, keepValue = ""){
  const first = selectEl.options[0];
  const firstText = first ? first.textContent : "Select";
  const firstVal = first ? first.value : "";
  selectEl.innerHTML = "";
  selectEl.add(new Option(firstText, firstVal));
  values.forEach(v => selectEl.add(new Option(v, v)));
  if (keepValue && values.includes(keepValue)) selectEl.value = keepValue;
}
function setSelectPlaceholder(selectEl, placeholderText){
  selectEl.innerHTML = "";
  selectEl.add(new Option(placeholderText, ""));
  selectEl.value = "";
}
function enableSelect(selectEl, enabled){
  selectEl.disabled = !enabled;
  selectEl.style.opacity = enabled ? "1" : "0.65";
  selectEl.style.cursor = enabled ? "pointer" : "not-allowed";
}

/* ========= Grade ordering (A+ higher than A) ========= */
function gradeRank(v){
  const s = String(v ?? "").trim().toUpperCase();
  const m = s.match(/^([A-Z])([+-])?$/);
  if (!m) return null;

  const letter = m[1];
  const sign = m[2] || "";
  const base = 26 - (letter.charCodeAt(0) - 64);
  const bump = sign === "+" ? 0.2 : (sign === "-" ? -0.2 : 0);
  return base + bump;
}
function sortClassificationOptions(values){
  const arr = [...values];
  arr.sort((a,b)=>{
    const ar = gradeRank(a);
    const br = gradeRank(b);
    if (ar != null && br != null) return br - ar;
    if (ar != null && br == null) return -1;
    if (ar == null && br != null) return 1;
    return String(a).localeCompare(String(b), "en-GB", { sensitivity: "base" });
  });
  return arr;
}

/* ========= Colours ========= */
const BRAND_PALETTE = ["#6aa6ff","#ff9fb3","#90e0c5","#ffd08a","#c9b6ff","#8fd3ff","#ffc6a8","#b2e1a1","#f5b3ff","#a4b0ff"];

/* Classification colours */
const CLASSIFICATION_COLOURS = {
  "A+": "#ff8b00",
  "A": "#90e0c5",
  "B": "#6aa6ff",
  "C": "#ffd08a",
  "D": "#ff9fb3",
  "Core": "#6aa6ff",
  "Seasonal": "#ffd08a",
  "New": "#c9b6ff",
  "Slow": "#ff9fb3",
  "Discontinued": "#a4b0ff",
  "Unknown": "#d9dbdf"
};
const CLASSIFICATION_FALLBACK = ["#90e0c5","#6aa6ff","#ffd08a","#c9b6ff","#ff9fb3","#b2e1a1","#8fd3ff","#ffc6a8","#a4b0ff"];

let brandColour = new Map();
let classificationColour = new Map();

function normaliseKey(s){
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g," ");
}
function buildColourMaps(items){
  const brands = uniqueSorted(items.map(r=>r.brand || "Unknown"));
  brandColour = new Map(brands.map((b,i)=>[b, BRAND_PALETTE[i % BRAND_PALETTE.length]]));

  const classes = uniqueSorted(items.map(r=>r.classification || "Unknown"));
  const pairs = [];
  let i = 0;
  for (const c of classes){
    const k = normaliseKey(c);
    const exact = CLASSIFICATION_COLOURS[c] || CLASSIFICATION_COLOURS[k] || null;
    pairs.push([c, exact || CLASSIFICATION_FALLBACK[i++ % CLASSIFICATION_FALLBACK.length]]);
  }
  classificationColour = new Map(pairs);
}
function hexToRgba(hex, alpha){
  const h = String(hex || "").replace("#","");
  if (h.length !== 6) return `rgba(217,219,223,${alpha})`;
  const r = parseInt(h.slice(0,2),16);
  const g = parseInt(h.slice(2,4),16);
  const b = parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function pillHTML(label, colour){
  const col = colour || "#d9dbdf";
  const bg = hexToRgba(col, 0.22);
  return `<span class="pill" style="background:${bg};">
    <span class="pill-dot" style="background:${col};"></span>
    ${label}
  </span>`;
}

/* ========= State ========= */
let rows = [];
let tableSortKey = "";
let tableSortDir = "desc";

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

/* ========= Column pickers ========= */
function pickSubcategory(r){
  const candidates = ["Sub Category 1","Subcategory 1","Sub Category1","Sub Category"];
  for (const c of candidates){
    if (c in r){
      const v = String(r[c] ?? "").trim();
      return v || "Unknown";
    }
  }
  return "Unknown";
}

function pickCalculatedRevenue(r){
  const candidates = ["Calculated Revenue ","Calculated Revenue","Calculated Revenue"];
  for (const c of candidates){
    if (c in r) return toNumber(r[c]);
  }
  return NaN;
}

/* ========= Hydrate ========= */
function hydrate(rawRows){
  const nonEmpty = (rawRows || []).filter(r => Object.values(r).some(v => String(v ?? "").trim() !== ""));

  rows = nonEmpty.map(r=>{
    const costEx = toNumber(r["Cost Price ex VAT"]);
    const sellEx = toNumber(r["Selling Price ex VAT"]);
    const sellInc = toNumber(r["Selling Price inc VAT"]);
    const saleInc = toNumber(r["Sale Price inc VAT"]);
    const profitPct = toNumber(r["Calculated Profit % Per Unit"]);

    const avail = toNumber(r["Availabile Stock"]);
    const supplier = toNumber(r["Supplier Stock"]);

    const unitsThisYear = toNumber(r["Total Sales this Year"]);
    const unitsLastYear = toNumber(r["Total Sales Last Year"]);

    const classification = String(r["Best Seller Status"] ?? "").trim() || "Unknown";
    const parent = String(r["Parent Category"] ?? "").trim() || "Unknown";
    const subcategory = pickSubcategory(r);

    const stockValue = toNumber(r["Stock Value"]);

    const revenueCalc = pickCalculatedRevenue(r);

    const revenueComputed = (Number.isFinite(unitsThisYear) && Number.isFinite(sellEx))
      ? unitsThisYear * sellEx
      : NaN;

    const profit = (Number.isFinite(unitsThisYear) && Number.isFinite(sellEx) && Number.isFinite(costEx))
      ? unitsThisYear * (sellEx - costEx)
      : NaN;

    const discountPct = (Number.isFinite(saleInc) && saleInc > 0 && Number.isFinite(sellInc) && sellInc > 0)
      ? ((sellInc - saleInc) / sellInc) * 100
      : NaN;

    // primary revenue for charts/KPI: Calculated Revenue if present, else computed
    const revenuePrimary = Number.isFinite(revenueCalc) ? revenueCalc : revenueComputed;

    return {
      productId: String(r["Product ID"] ?? "").trim(),
      sku: String(r["Product SKU"] ?? "").trim(),
      name: String(r["Product Name"] ?? "").trim(),
      brand: String(r["Brand"] ?? "").trim() || "Unknown",

      parent,
      subcategory,
      classification,

      costEx, sellEx, sellInc, saleInc,
      profitPct,

      avail, supplier,
      stockValue,

      unitsThisYear, unitsLastYear,

      discountPct,

      revenuePrimary,
      revenueCalc,
      revenueComputed,
      profit
    };
  });

  buildColourMaps(rows);

  tableSortKey = "";
  tableSortDir = "desc";

  populateTopFilters();
  populateTableFilters();
  refresh();
}

/* ========= Filters ========= */
function getFilters(){
  return {
    q: (document.getElementById("q").value || "").trim().toLowerCase(),
    brand: document.getElementById("brand").value,
    parent: document.getElementById("parent").value,
    subcategory: document.getElementById("subcategory").value,
    classification: document.getElementById("classification").value,

    tableQ: (document.getElementById("tableSearch").value || "").trim().toLowerCase(),
    onlySelling: document.getElementById("onlySelling").checked,

    tableBrand: document.getElementById("tableBrand").value,
    tableParent: document.getElementById("tableParent").value,
    tableSubcategory: document.getElementById("tableSubcategory").value,
    tableClassification: document.getElementById("tableClassification").value,

    minStockValue: toNumber(document.getElementById("minStockValue").value),
    maxStockValue: toNumber(document.getElementById("maxStockValue").value),

    tableLimit: document.getElementById("tableLimit").value
  };
}

function applyTopFilters(){
  const f = getFilters();
  return rows.filter(r=>{
    if (f.brand && r.brand !== f.brand) return false;
    if (f.parent && r.parent !== f.parent) return false;
    if (f.subcategory && r.subcategory !== f.subcategory) return false;
    if (f.classification && r.classification !== f.classification) return false;

    if (f.q){
      const hay = `${r.sku} ${r.name} ${r.productId}`.toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  });
}

function applyTableFilters(items){
  const f = getFilters();
  let out = items;

  if (f.onlySelling) out = out.filter(r => Number.isFinite(r.unitsThisYear) && r.unitsThisYear > 0);

  if (f.tableBrand) out = out.filter(r => r.brand === f.tableBrand);
  if (f.tableParent) out = out.filter(r => r.parent === f.tableParent);
  if (f.tableSubcategory) out = out.filter(r => r.subcategory === f.tableSubcategory);
  if (f.tableClassification) out = out.filter(r => r.classification === f.tableClassification);

  if (Number.isFinite(f.minStockValue)) out = out.filter(r => Number.isFinite(r.stockValue) && r.stockValue >= f.minStockValue);
  if (Number.isFinite(f.maxStockValue)) out = out.filter(r => Number.isFinite(r.stockValue) && r.stockValue <= f.maxStockValue);

  if (f.tableQ){
    out = out.filter(r => (`${r.sku} ${r.name} ${r.productId}`.toLowerCase().includes(f.tableQ)));
  }

  return out;
}

/* ========= Dependent dropdowns (Parent -> Subcategory) ========= */
function populateTopFilters(){
  const brandSel = document.getElementById("brand");
  const parentSel = document.getElementById("parent");
  const subSel = document.getElementById("subcategory");
  const classSel = document.getElementById("classification");

  const remember = {
    brand: brandSel.value,
    parent: parentSel.value,
    subcategory: subSel.value,
    classification: classSel.value
  };

  setSelectOptions(brandSel, uniqueSorted(rows.map(r=>r.brand)), remember.brand);
  setSelectOptions(parentSel, uniqueSorted(rows.map(r=>r.parent)), remember.parent);

  const classes = sortClassificationOptions(uniqueSorted(rows.map(r=>r.classification)));
  setSelectOptions(classSel, classes, remember.classification);

  if (!parentSel.value){
    setSelectPlaceholder(subSel, "Subcategory (select category first)");
    enableSelect(subSel, false);
  } else {
    const subs = uniqueSorted(rows.filter(r=>r.parent === parentSel.value).map(r=>r.subcategory));
    setSelectOptions(subSel, subs, remember.subcategory);
    enableSelect(subSel, true);
    if (remember.subcategory && !subs.includes(remember.subcategory)) subSel.value = "";
  }
}

function populateTableFilters(){
  const bSel = document.getElementById("tableBrand");
  const pSel = document.getElementById("tableParent");
  const sSel = document.getElementById("tableSubcategory");
  const cSel = document.getElementById("tableClassification");

  const remember = {
    b: bSel.value,
    p: pSel.value,
    s: sSel.value,
    c: cSel.value
  };

  setSelectOptions(bSel, uniqueSorted(rows.map(r=>r.brand)), remember.b);
  setSelectOptions(pSel, uniqueSorted(rows.map(r=>r.parent)), remember.p);

  const classes = sortClassificationOptions(uniqueSorted(rows.map(r=>r.classification)));
  setSelectOptions(cSel, classes, remember.c);

  if (!pSel.value){
    setSelectPlaceholder(sSel, "Subcategory (select category first)");
    enableSelect(sSel, false);
  } else {
    const subs = uniqueSorted(rows.filter(r=>r.parent === pSel.value).map(r=>r.subcategory));
    setSelectOptions(sSel, subs, remember.s);
    enableSelect(sSel, true);
    if (remember.s && !subs.includes(remember.s)) sSel.value = "";
  }
}

/* ========= Aggregations ========= */
function aggByBrand(items){
  const m = new Map();
  for (const r of items){
    const k = r.brand || "Unknown";
    if (!m.has(k)) m.set(k, { k, unitsThisYear:0, unitsLastYear:0, revenue:0, profit:0 });
    const o = m.get(k);

    o.unitsThisYear += Number.isFinite(r.unitsThisYear) ? r.unitsThisYear : 0;
    o.unitsLastYear += Number.isFinite(r.unitsLastYear) ? r.unitsLastYear : 0;
    o.revenue += Number.isFinite(r.revenuePrimary) ? r.revenuePrimary : 0;
    o.profit += Number.isFinite(r.profit) ? r.profit : 0;
  }
  return [...m.values()].sort((a,b)=> (b.revenue - a.revenue) || (b.profit - a.profit));
}

function aggByClassificationUnits(items){
  const m = new Map();
  for (const r of items){
    const k = r.classification || "Unknown";
    if (!m.has(k)) m.set(k, { k, thisYear:0, lastYear:0 });
    const o = m.get(k);
    o.thisYear += Number.isFinite(r.unitsThisYear) ? r.unitsThisYear : 0;
    o.lastYear += Number.isFinite(r.unitsLastYear) ? r.unitsLastYear : 0;
  }
  return [...m.values()].sort((a,b)=> b.thisYear - a.thisYear);
}

function aggByClassificationRevenue(items){
  const m = new Map();
  for (const r of items){
    const k = r.classification || "Unknown";
    m.set(k, (m.get(k) || 0) + (Number.isFinite(r.revenuePrimary) ? r.revenuePrimary : 0));
  }
  return [...m.entries()].map(([k,v])=>({k,v})).sort((a,b)=> b.v - a.v);
}

function aggByClassificationStockValue(items){
  const m = new Map();
  for (const r of items){
    const k = r.classification || "Unknown";
    m.set(k, (m.get(k) || 0) + (Number.isFinite(r.stockValue) ? r.stockValue : 0));
  }
  return [...m.entries()].map(([k,v])=>({k,v})).sort((a,b)=> b.v - a.v);
}

function aggByParentRevenue(items){
  const m = new Map();
  for (const r of items){
    const k = r.parent || "Unknown";
    m.set(k, (m.get(k) || 0) + (Number.isFinite(r.revenuePrimary) ? r.revenuePrimary : 0));
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

/* ========= Discount bands ========= */
function discountBand(p){
  if (!Number.isFinite(p)) return null;
  if (p < 5) return "0 to 5%";
  if (p < 10) return "5 to 10%";
  if (p < 20) return "10 to 20%";
  if (p < 30) return "20 to 30%";
  if (p < 40) return "30 to 40%";
  return "40%+";
}

/* ========= Charts ========= */
function drawBrandUnitsThisYearLastYear(items){
  const rows2 = aggByBrand(items).slice(0,12);
  const labels = rows2.map(x=>x.k);
  const colours = labels.map((b,i)=> brandColour.get(b) || BRAND_PALETTE[i % BRAND_PALETTE.length]);

  safePlot("brandUnitsThisYearLastYear", [
    { type:"bar", name:"Units sold this year", x:labels, y:rows2.map(x=>x.unitsThisYear), marker:{ color: colours, opacity: 0.82 } },
    { type:"bar", name:"Units sold last year", x:labels, y:rows2.map(x=>x.unitsLastYear), marker:{ color: colours, opacity: 0.45 } }
  ], {
    title:"Units Sold This Year vs Last Year by Brand (Top 12)",
    barmode:"group",
    xaxis:{ automargin:true, categoryorder:"array", categoryarray: labels, gridcolor:"rgba(217,219,223,0.12)" },
    yaxis:{ title:"Units", gridcolor:"rgba(217,219,223,0.12)" }
  });
}

function drawBrandRevProfit(items){
  const rows2 = aggByBrand(items).slice(0,12);
  const labels = rows2.map(x=>x.k);
  const colours = labels.map((b,i)=> brandColour.get(b) || BRAND_PALETTE[i % BRAND_PALETTE.length]);

  safePlot("brandRevProfit", [
    { type:"bar", name:"Revenue this year (Calculated Revenue)", x:labels, y:rows2.map(x=>x.revenue), marker:{ color: colours, opacity: 0.70 } },
    { type:"bar", name:"Profit this year", x:labels, y:rows2.map(x=>x.profit), marker:{ color: colours, opacity: 0.95 } }
  ], {
    title:"Revenue and Profit This Year by Brand (Top 12)",
    barmode:"group",
    xaxis:{ automargin:true, categoryorder:"array", categoryarray: labels, gridcolor:"rgba(217,219,223,0.12)" },
    yaxis:{ title:"£", gridcolor:"rgba(217,219,223,0.12)" }
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
  }], { title:"Parent Category Revenue Share (This Year)" });
}

function drawStockValueByClassification(items){
  const rows2 = aggByClassificationStockValue(items);
  const labels = rows2.map(x=>x.k);

  safePlot("stockValueByClassification", [{
    type:"bar",
    x: labels,
    y: rows2.map(x=>x.v),
    marker:{ color: rows2.map(x => classificationColour.get(x.k) || "#d9dbdf"), opacity: 0.92 },
    hovertemplate:"<b>%{x}</b><br>Stock value: £%{y:,.0f}<extra></extra>"
  }], {
    title:"Stock Value by Classification",
    xaxis:{ automargin:true, categoryorder:"array", categoryarray: labels, gridcolor:"rgba(217,219,223,0.12)" },
    yaxis:{ title:"£", gridcolor:"rgba(217,219,223,0.12)" }
  });
}

function drawDiscountBandsUnits(items){
  const bandsOrder = ["0 to 5%","5 to 10%","10 to 20%","20 to 30%","30 to 40%","40%+"];

  const m = new Map(bandsOrder.map(b=>[b, { band:b, units:0 }]));
  for (const r of items){
    const b = discountBand(r.discountPct);
    if (!b) continue;
    m.get(b).units += Number.isFinite(r.unitsThisYear) ? r.unitsThisYear : 0;
  }

  const rows2 = bandsOrder.map(b=>m.get(b));
  safePlot("discountBandsUnits", [{
    type:"bar",
    x: rows2.map(x=>x.band),
    y: rows2.map(x=>x.units),
    hovertemplate:"%{x}<br>Units sold this year: %{y:,.0f}<extra></extra>",
    marker:{ opacity: 0.85, color:"#ff8b00" }
  }], {
    title:"Discount Bands vs Units Sold This Year",
    xaxis:{ automargin:true, gridcolor:"rgba(217,219,223,0.12)" },
    yaxis:{ title:"Units sold this year", gridcolor:"rgba(217,219,223,0.12)" }
  });
}

function drawClassificationShare(items){
  const rows2 = topNWithOtherPairs(aggByClassificationRevenue(items).map(x=>({k:x.k, v:x.v})), 10);
  safePlot("classificationShare", [{
    type:"pie",
    labels: rows2.map(x=>x.k),
    values: rows2.map(x=>x.v),
    hole: 0.45,
    textinfo:"label+percent",
    marker:{ colors: rows2.map(x=> classificationColour.get(x.k) || "#d9dbdf") }
  }], { title:"Classification Share (Revenue This Year)" });
}

function drawClassificationUnitsThisYearLastYear(items){
  const rows2 = aggByClassificationUnits(items).slice(0,12);
  const labels = rows2.map(x=>x.k);
  const colours = labels.map(s=> classificationColour.get(s) || "#d9dbdf");

  safePlot("classificationUnitsThisYearLastYear", [
    { type:"bar", name:"Units sold this year", x:labels, y:rows2.map(x=>x.thisYear), marker:{ color: colours, opacity: 0.82 } },
    { type:"bar", name:"Units sold last year", x:labels, y:rows2.map(x=>x.lastYear), marker:{ color: colours, opacity: 0.45 } }
  ], {
    title:"Units Sold This Year vs Last Year by Classification (Top 12)",
    barmode:"group",
    xaxis:{ automargin:true, categoryorder:"array", categoryarray: labels, gridcolor:"rgba(217,219,223,0.12)" },
    yaxis:{ title:"Units", gridcolor:"rgba(217,219,223,0.12)" }
  });
}

function drawTopSkuMetric(items, chartId, title, valueFn, valueLabel, isMoney){
  const top = items
    .map(r => ({ r, v: valueFn(r) }))
    .filter(x => Number.isFinite(x.v) && x.v > 0)
    .sort((a,b)=> b.v - a.v)
    .slice(0, 30)
    .map(x => ({ ...x.r, v: x.v }));

  const y = top.map(r => r.sku || "(no sku)");
  const x = top.map(r => r.v);
  const colours = top.map((r,i)=> brandColour.get(r.brand) || BRAND_PALETTE[i % BRAND_PALETTE.length]);

  const hover = top.map(r =>
    `<b>${r.sku}</b><br>${r.name}` +
    `<br>${r.brand} | ${r.parent} | ${r.subcategory}` +
    `<br>Classification: ${r.classification}` +
    `<br>${valueLabel}: ${isMoney ? fmtGBP(r.v) : fmtInt(r.v)}`
  );

  safePlot(chartId, [{
    type:"bar",
    orientation:"h",
    y, x,
    marker:{ color: colours, opacity: 0.92 },
    hovertext: hover,
    hoverinfo: "text"
  }], {
    title,
    xaxis:{ title: isMoney ? "£" : "Units", gridcolor:"rgba(217,219,223,0.12)" },
    yaxis:{ automargin:true, autorange:"reversed", gridcolor:"rgba(217,219,223,0.06)" },
    margin: { t: 56, l: 180, r: 18, b: 60 }
  });
}

/* ========= KPIs ========= */
function renderKpis(items){
  document.getElementById("kpiProducts").textContent = items.length.toLocaleString("en-GB");

  const unitsThisYear = sum(items.map(r=>r.unitsThisYear));
  const unitsLastYear = sum(items.map(r=>r.unitsLastYear));
  const revenue = sum(items.map(r=>r.revenuePrimary));
  const profit = sum(items.map(r=>r.profit));
  const stockValue = sum(items.map(r=>r.stockValue));

  document.getElementById("kpiUnitsThisYear").textContent = fmtInt(unitsThisYear);
  document.getElementById("kpiUnitsLastYear").textContent = fmtInt(unitsLastYear);
  document.getElementById("kpiRevenue").textContent = fmtGBP(revenue);
  document.getElementById("kpiProfit").textContent = fmtGBP(profit);
  document.getElementById("kpiStockValue").textContent = fmtGBP(stockValue);

  const classes = aggByClassificationRevenue(items).slice(0, 3);
  const el = document.getElementById("kpiClassificationSummary");
  if (el){
    el.innerHTML = classes.map(c => pillHTML(`${c.k}: ${fmtGBP(c.v)}`, classificationColour.get(c.k))).join("");
  }
}

/* ========= Table sorting ========= */
function compareText(a, b){
  const ar = gradeRank(a);
  const br = gradeRank(b);
  if (ar != null && br != null) return ar - br;
  return String(a ?? "").localeCompare(String(b ?? ""), "en-GB", { sensitivity: "base" });
}
function compareNum(a, b){
  const na = Number.isFinite(a) ? a : NaN;
  const nb = Number.isFinite(b) ? b : NaN;
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (Number.isFinite(na) && !Number.isFinite(nb)) return 1;
  if (!Number.isFinite(na) && Number.isFinite(nb)) return -1;
  return 0;
}
function applyTableSort(items){
  if (!tableSortKey) return items;

  const th = document.querySelector(`#tbl thead th[data-key="${tableSortKey}"]`);
  const type = th?.dataset?.type || "text";
  const dir = tableSortDir === "asc" ? 1 : -1;

  const copy = [...items];
  copy.sort((ra, rb)=>{
    const a = ra[tableSortKey];
    const b = rb[tableSortKey];
    const c = type === "num" ? compareNum(a, b) : compareText(a, b);
    return c * dir;
  });

  return copy;
}
function updateSortHeaderUI(){
  const headers = document.querySelectorAll("#tbl thead th[data-key]");
  headers.forEach(h=>{
    h.classList.remove("sorted");
    const k = h.dataset.key;
    const base = h.textContent.replace(/\s*(▲|▼)\s*$/,"").trim();
    h.textContent = base;
    if (k === tableSortKey){
      h.classList.add("sorted");
      h.textContent = `${base} ${tableSortDir === "asc" ? "▲" : "▼"}`;
    }
  });

  const meta = document.getElementById("tableSortMeta");
  if (meta){
    meta.textContent = tableSortKey ? `Table sort: ${tableSortKey} (${tableSortDir})` : "";
  }
}
function bindTableHeaderSorting(){
  const headers = document.querySelectorAll("#tbl thead th[data-key]");
  headers.forEach(h=>{
    h.addEventListener("click", ()=>{
      const key = h.dataset.key;
      if (tableSortKey === key){
        tableSortDir = tableSortDir === "asc" ? "desc" : "asc";
      } else {
        tableSortKey = key;
        tableSortDir = "desc";
      }
      updateSortHeaderUI();
      refresh();
    });
  });
}

/* ========= Table render ========= */
function renderTable(items){
  const tbody = document.querySelector("#tbl tbody");
  tbody.innerHTML = "";

  const f = getFilters();
  const filtered = applyTableFilters(items);
  const sorted = applyTableSort(filtered);

  const limit = (f.tableLimit === "all") ? sorted.length : Math.max(1, parseInt(f.tableLimit, 10) || 50);
  const shown = sorted.slice(0, limit);

  for (const r of shown){
    const brandPill = pillHTML(r.brand, brandColour.get(r.brand));
    const classPill = pillHTML(r.classification, classificationColour.get(r.classification));

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.sku}</td>
      <td>${r.name}</td>

      <td>${brandPill}</td>
      <td>${r.parent}</td>
      <td>${r.subcategory}</td>
      <td>${classPill}</td>

      <td>${fmtInt(r.unitsThisYear)}</td>
      <td>${fmtInt(r.unitsLastYear)}</td>

      <td>${fmtInt(r.avail)}</td>
      <td>${fmtInt(r.supplier)}</td>
      <td>${fmtGBP(r.stockValue)}</td>

      <td>${fmtGBP(r.revenueCalc)}</td>
      <td>${fmtGBP(r.revenueComputed)}</td>
      <td>${fmtGBP(r.profit)}</td>

      <td>${fmtGBP(r.costEx)}</td>
      <td>${fmtGBP(r.sellEx)}</td>
      <td>${fmtGBP(r.sellInc)}</td>
      <td>${Number.isFinite(r.saleInc) && r.saleInc > 0 ? fmtGBP(r.saleInc) : "-"}</td>

      <td>${fmtPct(r.discountPct)}</td>
      <td>${fmtPct(r.profitPct)}</td>
    `;
    tbody.appendChild(tr);
  }

  const meta = document.getElementById("tableMeta");
  if (meta){
    meta.textContent = `${filtered.length.toLocaleString("en-GB")} rows match SKU Explorer filters (showing ${shown.length.toLocaleString("en-GB")})`;
  }
}

/* ========= Refresh ========= */
function refresh(){
  const items = applyTopFilters();

  renderKpis(items);

  drawBrandUnitsThisYearLastYear(items);
  drawBrandRevProfit(items);
  drawParentRevenueShare(items);
  drawStockValueByClassification(items);
  drawDiscountBandsUnits(items);
  drawClassificationShare(items);
  drawClassificationUnitsThisYearLastYear(items);

  drawTopSkuMetric(items, "topSkuProfit", "Top SKUs by Profit This Year", r => r.profit, "Profit", true);
  drawTopSkuMetric(items, "topSkuRevenue", "Top SKUs by Revenue This Year", r => r.revenuePrimary, "Revenue", true);
  drawTopSkuMetric(items, "topSkuUnits", "Top SKUs by Units Sold This Year", r => r.unitsThisYear, "Units", false);

  renderTable(items);
}

/* ========= Events ========= */
function resetFilters(){
  document.getElementById("q").value = "";
  document.getElementById("brand").value = "";
  document.getElementById("parent").value = "";
  document.getElementById("subcategory").value = "";
  document.getElementById("classification").value = "";

  document.getElementById("tableSearch").value = "";
  document.getElementById("onlySelling").checked = false;
  document.getElementById("tableBrand").value = "";
  document.getElementById("tableParent").value = "";
  document.getElementById("tableSubcategory").value = "";
  document.getElementById("tableClassification").value = "";
  document.getElementById("minStockValue").value = "";
  document.getElementById("maxStockValue").value = "";
  document.getElementById("tableLimit").value = "50";

  tableSortKey = "";
  tableSortDir = "desc";
  updateSortHeaderUI();

  populateTopFilters();
  populateTableFilters();
  refresh();
}

function bind(){
  document.getElementById("file").addEventListener("change", e=>{
    const f = e.target.files?.[0];
    if (f) loadFromFile(f).catch(console.error);
  });

  document.getElementById("reset").addEventListener("click", resetFilters);

  ["q","brand","classification"].forEach(id=>{
    document.getElementById(id).addEventListener("input", debounce(refresh, 140));
    document.getElementById(id).addEventListener("change", debounce(refresh, 140));
  });

  // Parent -> Subcategory dependency (top)
  document.getElementById("parent").addEventListener("change", ()=>{
    document.getElementById("subcategory").value = "";
    populateTopFilters();
    refresh();
  });

  // Subcategory itself (top)
  document.getElementById("subcategory").addEventListener("change", debounce(refresh, 140));

  [
    "tableSearch","onlySelling",
    "tableBrand","tableClassification",
    "minStockValue","maxStockValue","tableLimit"
  ].forEach(id=>{
    const el = document.getElementById(id);
    el.addEventListener("input", debounce(refresh, 140));
    el.addEventListener("change", debounce(refresh, 140));
  });

  // Parent -> Subcategory dependency (table)
  document.getElementById("tableParent").addEventListener("change", ()=>{
    document.getElementById("tableSubcategory").value = "";
    populateTableFilters();
    refresh();
  });

  // Subcategory itself (table)
  document.getElementById("tableSubcategory").addEventListener("change", debounce(refresh, 140));

  bindTableHeaderSorting();
  updateSortHeaderUI();

  enableSelect(document.getElementById("subcategory"), false);
  enableSelect(document.getElementById("tableSubcategory"), false);
}

/* ========= Boot ========= */
window.addEventListener("DOMContentLoaded", ()=>{
  bind();
  loadFromPath(BUILT_IN_CSV).catch(err => console.error("Auto load failed:", err));
});