/* ========= Configuration ========= */
const BUILT_IN_CSV = "MakitaExport.csv";

/* ========= Plotly layout ========= */
const baseLayout = {
  paper_bgcolor: "rgba(255,255,255,0)",
  plot_bgcolor: "rgba(255,255,255,0)",
  font: { family: "Inter, system-ui, Segoe UI, Arial, sans-serif", color: "#1f2530" },
  margin: { t: 56, l: 60, r: 18, b: 60 }
};

function toNumber(v){
  if (v == null) return NaN;
  const s = String(v).replace(/[,£%]/g, "").trim();
  if (!s) return NaN;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}
function toInt(v){
  const n = toNumber(v);
  if (!Number.isFinite(n)) return NaN;
  return Math.trunc(n);
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
  return Number.isFinite(n) ? n.toLocaleString("en-GB") : "–";
}
const sum = arr => arr.reduce((s,v)=> s + (Number.isFinite(v) ? v : 0), 0);
const debounce = (fn,ms=180)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

/* ========= State ========= */
let rows = [];
let cols = [];
let idx = {};

/* ========= CSV parsing ========= */
function parseCSVText(csvText){
  return new Promise((resolve,reject)=>{
    Papa.parse(csvText,{
      header: true,
      skipEmptyLines: "greedy",
      dynamicTyping: false,
      complete: r => resolve({ data: r.data, fields: r.meta.fields || [] }),
      error: reject
    });
  });
}

async function loadFromFile(file){
  const txt = await file.text();
  const parsed = await parseCSVText(txt);
  hydrate(parsed);
}

async function loadFromPath(path){
  const r = await fetch(path, { cache: "no-store" });
  if(!r.ok) throw new Error("Fetch CSV failed");
  const parsed = await parseCSVText(await r.text());
  hydrate(parsed);
}

/* ========= Hydrate ========= */
function hydrate(parsed){
  cols = parsed.fields;
  rows = (parsed.data || []).filter(r => Object.values(r).some(v => String(v ?? "").trim() !== ""));

  const want = [
    "Product ID","Product SKU","Brand","Parent Category","Sub Category 1","Sub Category 2","Brand Category","Product Name",
    "Optimised Description?","PDP?","Promo Badges","Number of Offer Categories","Bulk Pricing Rules?","Number of Images",
    "Filters Correct?","Batteries Included","Part of a Kit?",
    "Cost Price ex VAT","Selling Price inc VAT","Selling Price ex VAT","Sale Price","Calculated Profit % Per Unit",
    "Stock Value","Availabile Stock","Supplier Stock","On Order?","Total Sales this Year","Total Sales Last Year","Best Seller Status"
  ];
  idx = {};
  want.forEach(k => idx[k] = cols.includes(k) ? k : null);

  rows = rows.map(r => {
    const cost = toNumber(r[idx["Cost Price ex VAT"]]);
    const sellEx = toNumber(r[idx["Selling Price ex VAT"]]);
    const sale = toNumber(r[idx["Sale Price"]]);
    const profitPct = toNumber(r[idx["Calculated Profit % Per Unit"]]);

    const effectiveSellEx = (Number.isFinite(sale) && sale > 0) ? sale : sellEx;

    const unitsYtd = toNumber(r[idx["Total Sales this Year"]]);
    const unitsLy = toNumber(r[idx["Total Sales Last Year"]]);

    const estRevYtd = (Number.isFinite(unitsYtd) && Number.isFinite(effectiveSellEx)) ? unitsYtd * effectiveSellEx : NaN;

    return {
      productId: String(r[idx["Product ID"]] ?? "").trim(),
      sku: String(r[idx["Product SKU"]] ?? "").trim(),
      brand: String(r[idx["Brand"]] ?? "").trim(),
      parentCat: String(r[idx["Parent Category"]] ?? "").trim(),
      subCat1: String(r[idx["Sub Category 1"]] ?? "").trim(),
      subCat2: String(r[idx["Sub Category 2"]] ?? "").trim(),
      brandCat: String(r[idx["Brand Category"]] ?? "").trim(),
      name: String(r[idx["Product Name"]] ?? "").trim(),

      pdp: truthy(r[idx["PDP?"]]),
      optimisedDesc: truthy(r[idx["Optimised Description?"]]),
      filtersCorrect: truthy(r[idx["Filters Correct?"]]),
      images: toInt(r[idx["Number of Images"]]),
      bestseller: String(r[idx["Best Seller Status"]] ?? "").trim(),

      costEx: cost,
      sellEx: sellEx,
      salePrice: sale,
      effectiveSellEx,
      profitPct,

      stockValue: toNumber(r[idx["Stock Value"]]),
      availStock: toNumber(r[idx["Availabile Stock"]]),
      supplierStock: toNumber(r[idx["Supplier Stock"]]),
      onOrder: truthy(r[idx["On Order?"]]),

      unitsYtd,
      unitsLy,
      estRevYtd
    };
  });

  populateFilters();
  refresh();
}

/* ========= Filters ========= */
function uniqueSorted(values){
  return [...new Set(values.map(v => String(v ?? "").trim()).filter(v => v !== ""))].sort((a,b)=>a.localeCompare(b));
}

function getFilters(){
  return {
    q: document.getElementById("skuSearch").value.trim().toLowerCase(),
    brand: document.getElementById("brandFilter").value,
    parent: document.getElementById("parentCatFilter").value,
    sub1: document.getElementById("subCat1Filter").value,
    best: document.getElementById("bestsellerFilter").value,
    quality: document.getElementById("qualityFilter").value
  };
}

function applyFilters(){
  const f = getFilters();
  return rows.filter(r => {
    if (f.brand && r.brand !== f.brand) return false;
    if (f.parent && r.parentCat !== f.parent) return false;
    if (f.sub1 && r.subCat1 !== f.sub1) return false;
    if (f.best && r.bestseller !== f.best) return false;

    if (f.q){
      const hay = (r.sku + " " + r.name + " " + r.productId).toLowerCase();
      if (!hay.includes(f.q)) return false;
    }

    if (f.quality){
      if (f.quality === "missingPdp" && r.pdp) return false;
      if (f.quality === "missingDesc" && r.optimisedDesc) return false;
      if (f.quality === "badFilters" && r.filtersCorrect) return false;
      if (f.quality === "lowImages" && (Number.isFinite(r.images) ? r.images > 1 : false)) return false;
    }
    return true;
  });
}

function populateFilters(){
  const brandSel = document.getElementById("brandFilter");
  const parentSel = document.getElementById("parentCatFilter");
  const sub1Sel = document.getElementById("subCat1Filter");
  const bestSel = document.getElementById("bestsellerFilter");

  brandSel.length = 1;
  parentSel.length = 1;
  sub1Sel.length = 1;
  bestSel.length = 1;

  uniqueSorted(rows.map(r => r.brand)).forEach(v => brandSel.add(new Option(v, v)));
  uniqueSorted(rows.map(r => r.parentCat)).forEach(v => parentSel.add(new Option(v, v)));
  uniqueSorted(rows.map(r => r.subCat1)).forEach(v => sub1Sel.add(new Option(v, v)));
  uniqueSorted(rows.map(r => r.bestseller)).forEach(v => bestSel.add(new Option(v, v)));
}

/* ========= Charts ========= */
function chartHeight(id){
  return document.getElementById(id)?.clientHeight || 460;
}

function drawTopUnits(items){
  const top = items
    .map(r => ({ label: `${r.sku} | ${r.name}`.slice(0, 64), units: r.unitsYtd }))
    .filter(x => Number.isFinite(x.units) && x.units > 0)
    .sort((a,b)=> b.units - a.units)
    .slice(0, 25);

  Plotly.newPlot("topUnitsBar", [{
    type: "bar",
    x: top.map(t => t.label),
    y: top.map(t => t.units),
    hovertemplate: "%{x}<br>%{y:.0f} units<extra></extra>"
  }], {
    ...baseLayout,
    title: "Top Products by Units Sold (This Year)",
    xaxis: { automargin: true, showticklabels: false },
    yaxis: { title: "Units" },
    height: chartHeight("topUnitsBar")
  }, { responsive: true });
}

function drawStockValueByCat(items){
  const by = new Map();
  for (const r of items){
    const k = r.parentCat || "Uncategorised";
    by.set(k, (by.get(k) || 0) + (Number.isFinite(r.stockValue) ? r.stockValue : 0));
  }
  const rows2 = [...by.entries()].map(([k,v]) => ({ k, v })).sort((a,b)=> b.v - a.v).slice(0, 20);

  Plotly.newPlot("stockValueByCat", [{
    type: "bar",
    x: rows2.map(x => x.k),
    y: rows2.map(x => x.v),
    hovertemplate: "%{x}<br>£%{y:,.0f}<extra></extra>"
  }], {
    ...baseLayout,
    title: "Stock Value by Parent Category",
    xaxis: { automargin: true },
    yaxis: { title: "£" },
    height: chartHeight("stockValueByCat")
  }, { responsive: true });
}

function drawProfitHist(items){
  const vals = items.map(r => r.profitPct).filter(v => Number.isFinite(v));
  Plotly.newPlot("profitHist", [{
    type: "histogram",
    x: vals,
    nbinsx: 30,
    hovertemplate: "Profit %: %{x}<extra></extra>"
  }], {
    ...baseLayout,
    title: "Profit % Distribution (Per Unit)",
    xaxis: { title: "Profit %" },
    yaxis: { title: "Count" },
    height: chartHeight("profitHist")
  }, { responsive: true });
}

function drawSalesVsProfit(items){
  const x = [];
  const y = [];
  const size = [];
  const text = [];

  for (const r of items){
    if (!Number.isFinite(r.unitsYtd) || !Number.isFinite(r.profitPct)) continue;
    x.push(r.unitsYtd);
    y.push(r.profitPct);
    size.push(Math.max(6, Math.min(50, (Number.isFinite(r.stockValue) ? Math.sqrt(r.stockValue) : 10))));
    text.push(`${r.sku} | ${r.name}<br>Units YTD: ${fmtInt(r.unitsYtd)}<br>Profit %: ${r.profitPct}<br>Stock Value: ${fmtGBP(r.stockValue)}`);
  }

  Plotly.newPlot("salesVsProfit", [{
    type: "scatter",
    mode: "markers",
    x, y,
    text,
    hoverinfo: "text",
    marker: { size, opacity: 0.7 }
  }], {
    ...baseLayout,
    title: "Units Sold vs Profit % (Bubble by Stock Value)",
    xaxis: { title: "Units Sold This Year" },
    yaxis: { title: "Profit % per unit" },
    height: chartHeight("salesVsProfit")
  }, { responsive: true });
}

function drawContentReadiness(items){
  let ok = 0, needs = 0;
  for (const r of items){
    const ready = r.pdp && r.optimisedDesc && r.filtersCorrect && (Number.isFinite(r.images) ? r.images >= 2 : false);
    if (ready) ok += 1;
    else needs += 1;
  }

  Plotly.newPlot("contentReadiness", [{
    type: "pie",
    labels: ["Ready", "Needs work"],
    values: [ok, needs],
    hole: 0.45,
    textinfo: "label+percent"
  }], {
    ...baseLayout,
    title: "Content Readiness (PDP + Description + Filters + Images>=2)",
    height: chartHeight("contentReadiness")
  }, { responsive: true });
}

function drawImagesByStatus(items){
  const groups = new Map();
  for (const r of items){
    const k = r.bestseller || "Unspecified";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(Number.isFinite(r.images) ? r.images : 0);
  }
  const rows2 = [...groups.entries()]
    .map(([k,arr]) => ({ k, avg: arr.length ? (sum(arr) / arr.length) : 0, count: arr.length }))
    .sort((a,b)=> b.count - a.count)
    .slice(0, 12);

  Plotly.newPlot("imagesByStatus", [{
    type: "bar",
    x: rows2.map(x => x.k),
    y: rows2.map(x => x.avg),
    hovertemplate: "%{x}<br>Avg images: %{y:.2f}<extra></extra>"
  }], {
    ...baseLayout,
    title: "Average Images (Grouped by Best Seller Status)",
    xaxis: { automargin: true },
    yaxis: { title: "Average images" },
    height: chartHeight("imagesByStatus")
  }, { responsive: true });
}

function drawStockScatter(items){
  const x = [];
  const y = [];
  const text = [];

  for (const r of items){
    if (!Number.isFinite(r.availStock) || !Number.isFinite(r.supplierStock)) continue;
    x.push(r.availStock);
    y.push(r.supplierStock);
    text.push(`${r.sku} | ${r.name}<br>Available: ${fmtInt(r.availStock)}<br>Supplier: ${fmtInt(r.supplierStock)}`);
  }

  Plotly.newPlot("stockScatter", [{
    type: "scatter",
    mode: "markers",
    x, y,
    text,
    hoverinfo: "text",
    marker: { opacity: 0.7 }
  }], {
    ...baseLayout,
    title: "Availability vs Supplier Stock",
    xaxis: { title: "Available Stock" },
    yaxis: { title: "Supplier Stock" },
    height: chartHeight("stockScatter")
  }, { responsive: true });
}

function drawPriceScatter(items){
  const x = [];
  const y = [];
  const text = [];

  for (const r of items){
    if (!Number.isFinite(r.costEx) || !Number.isFinite(r.effectiveSellEx)) continue;
    x.push(r.costEx);
    y.push(r.effectiveSellEx);
    const saleTxt = Number.isFinite(r.salePrice) && r.salePrice > 0 ? `Sale: ${r.salePrice}` : "Sale: n/a";
    text.push(`${r.sku} | ${r.name}<br>Cost ex VAT: ${fmtGBP(r.costEx)}<br>Selling ex VAT: ${fmtGBP(r.effectiveSellEx)}<br>${saleTxt}`);
  }

  Plotly.newPlot("priceScatter", [{
    type: "scatter",
    mode: "markers",
    x, y,
    text,
    hoverinfo: "text",
    marker: { opacity: 0.7 }
  }], {
    ...baseLayout,
    title: "Pricing (Selling ex VAT vs Cost ex VAT)",
    xaxis: { title: "Cost Price (ex VAT)" },
    yaxis: { title: "Selling Price (ex VAT, sale if present)" },
    height: chartHeight("priceScatter")
  }, { responsive: true });
}

/* ========= Table ========= */
function renderTable(items){
  const tbody = document.querySelector("#productTable tbody");
  tbody.innerHTML = "";

  const limit = 800;
  const shown = items.slice(0, limit);

  for (const r of shown){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.sku}</td>
      <td>${r.name}</td>
      <td>${r.brand}</td>
      <td>${r.parentCat}</td>
      <td>${r.subCat1}</td>
      <td>${r.bestseller}</td>
      <td>${fmtInt(r.availStock)}</td>
      <td>${fmtInt(r.supplierStock)}</td>
      <td>${fmtGBP(r.stockValue)}</td>
      <td>${fmtInt(r.unitsYtd)}</td>
      <td>${fmtInt(r.unitsLy)}</td>
      <td>${fmtGBP(r.costEx)}</td>
      <td>${fmtGBP(r.sellEx)}</td>
      <td>${Number.isFinite(r.salePrice) ? fmtGBP(r.salePrice) : "–"}</td>
      <td>${Number.isFinite(r.profitPct) ? r.profitPct : "–"}</td>
      <td>${r.pdp ? "Yes" : "No"}</td>
      <td>${r.optimisedDesc ? "Yes" : "No"}</td>
      <td>${Number.isFinite(r.images) ? r.images : "–"}</td>
      <td>${r.filtersCorrect ? "Yes" : "No"}</td>
    `;
    tbody.appendChild(tr);
  }

  const meta = document.getElementById("tableMeta");
  meta.textContent = `Showing ${shown.length.toLocaleString("en-GB")} of ${items.length.toLocaleString("en-GB")} matching products`;
}

/* ========= Refresh ========= */
function refresh(){
  const items = applyFilters();

  document.getElementById("kpiProducts").textContent = items.length.toLocaleString("en-GB");
  document.getElementById("kpiStockValue").textContent = fmtGBP(sum(items.map(r => r.stockValue)));
  document.getElementById("kpiUnitsYtd").textContent = fmtInt(sum(items.map(r => r.unitsYtd)));
  document.getElementById("kpiUnitsLy").textContent = fmtInt(sum(items.map(r => r.unitsLy)));
  document.getElementById("kpiEstRevYtd").textContent = fmtGBP(sum(items.map(r => r.estRevYtd)));

  const lowStock = items.filter(r => Number.isFinite(r.availStock) && r.availStock <= 2).length;
  document.getElementById("kpiLowStock").textContent = lowStock.toLocaleString("en-GB");

  drawTopUnits(items);
  drawStockValueByCat(items);
  drawProfitHist(items);
  drawSalesVsProfit(items);

  drawContentReadiness(items);
  drawImagesByStatus(items);
  drawStockScatter(items);
  drawPriceScatter(items);

  renderTable(items);
}

/* ========= Events ========= */
function resetFilters(){
  document.getElementById("skuSearch").value = "";
  document.getElementById("brandFilter").value = "";
  document.getElementById("parentCatFilter").value = "";
  document.getElementById("subCat1Filter").value = "";
  document.getElementById("bestsellerFilter").value = "";
  document.getElementById("qualityFilter").value = "";
  refresh();
}

function bind(){
  document.getElementById("file").addEventListener("change", e=>{
    const f = e.target.files?.[0];
    if (f) loadFromFile(f).catch(console.error);
  });

  document.getElementById("resetBtn").addEventListener("click", resetFilters);

  ["skuSearch","brandFilter","parentCatFilter","subCat1Filter","bestsellerFilter","qualityFilter"].forEach(id=>{
    document.getElementById(id).addEventListener("input", debounce(refresh, 140));
  });
}

/* ========= Boot ========= */
window.addEventListener("DOMContentLoaded", ()=>{
  bind();
  loadFromPath(BUILT_IN_CSV).catch(err=>{
    console.error("Auto load failed:", err);
  });
});
