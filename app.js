// ============================================================
// TCM IT Asset Dashboard — Core Logic
// ============================================================

const COSTS = { ssd256: 9000, ssd512: 15000, newPC: 40000 };
const HEAVY_USERS = ["Regina", "Margaret"];

// ── Decision Engine ──────────────────────────────────────────
function categorize(pc) {
  const isHDD = pc.diskType === "HDD";
  const isNew = ["NEW", "NEW/OLD"].includes(pc.condition.toUpperCase().trim()) ||
                pc.condition.toUpperCase().includes("NEW");
  const isOld = pc.condition.toUpperCase().includes("OLD") ||
                pc.condition.toUpperCase().includes("DEAD") ||
                pc.condition.toUpperCase().includes("REPLACED");
  const isDead = pc.condition.toUpperCase().includes("DEAD");
  const complaints = pc.complaints.toUpperCase().trim();
  const isHeavy = HEAVY_USERS.some(u => pc.user.toLowerCase().includes(u.toLowerCase()));

  // SSD already — usually OK
  if (!isHDD) {
    return { status: "OK", priority: "Low", action: "No action needed", cost: 0 };
  }

  // DEAD machine
  if (isDead) {
    return { status: "Replace", priority: "Critical", action: "Immediate replacement", cost: COSTS.newPC };
  }

  // HDD + NEW + No complaints → OK (monitor)
  if (isHDD && isNew && complaints === "NONE") {
    const ssdCost = isHeavy ? COSTS.ssd512 : COSTS.ssd256;
    return { status: "OK", priority: "Low", action: "Monitor — SSD upgrade when needed", cost: 0, futureCost: ssdCost };
  }

  // HDD + NEW + HIGH complaints → Upgrade immediately
  if (isHDD && isNew && complaints === "HIGH") {
    const ssdCost = isHeavy ? COSTS.ssd512 : COSTS.ssd256;
    return { status: "Upgrade", priority: "High", action: `SSD Upgrade (${isHeavy ? "512GB" : "256GB"})`, cost: ssdCost };
  }

  // HDD + OLD + HIGH complaints → Replace (after assessment)
  if (isHDD && isOld && complaints === "HIGH") {
    return { status: "Replace", priority: "High", action: "Assessment → Replacement", cost: COSTS.newPC };
  }

  // HDD + OLD + LOW complaints → Review / upgrade first
  if (isHDD && isOld && (complaints === "LOW" || complaints === "NONE")) {
    const ssdCost = isHeavy ? COSTS.ssd512 : COSTS.ssd256;
    return { status: "Review", priority: "Medium", action: `SSD Upgrade (${isHeavy ? "512GB" : "256GB"}) — evaluate`, cost: ssdCost };
  }

  // fallback
  const ssdCost = isHeavy ? COSTS.ssd512 : COSTS.ssd256;
  return { status: "Review", priority: "Medium", action: "Manual assessment required", cost: ssdCost };
}

function enrichData(computers) {
  return computers.map(pc => ({ ...pc, ...categorize(pc) }));
}

// ── Global State ─────────────────────────────────────────────
let allData = [];
let filteredData = [];
let scenario = "upgrade"; // "upgrade" | "replace"
let activeFilters = { status: "All", priority: "All", office: "All", search: "" };
let charts = {};
let darkMode = false;

// ── Bootstrap ─────────────────────────────────────────────────
async function init() {
  const res = await fetch("data.json");
  const json = await res.json();
  allData = enrichData(json.computers);
  filteredData = [...allData];
  applyFilters();
  renderAll();
  initCharts();
  bindEvents();
  initTheme();
}

// ── Filtering ─────────────────────────────────────────────────
function applyFilters() {
  filteredData = allData.filter(pc => {
    const matchStatus  = activeFilters.status  === "All" || pc.status  === activeFilters.status;
    const matchPriority= activeFilters.priority === "All" || pc.priority=== activeFilters.priority;
    const matchOffice  = activeFilters.office   === "All" || pc.office  === activeFilters.office;
    const matchSearch  = !activeFilters.search  ||
      [pc.user, pc.department, pc.model, pc.office].some(f =>
        f.toLowerCase().includes(activeFilters.search.toLowerCase()));
    return matchStatus && matchPriority && matchOffice && matchSearch;
  });
}

// ── Compute Summary ───────────────────────────────────────────
function getSummary(data) {
  const total       = data.length;
  const upgrades    = data.filter(d => d.status === "Upgrade").length;
  const reviews     = data.filter(d => d.status === "Review").length;
  const replacements= data.filter(d => d.status === "Replace").length;
  const ok          = data.filter(d => d.status === "OK").length;

  const upgradeCost  = data.filter(d => d.status === "Upgrade" || d.status === "Review")
                           .reduce((s, d) => s + d.cost, 0);
  const replaceCost  = allData.filter(d => d.status === "Upgrade" || d.status === "Review" || d.status === "Replace")
                              .reduce(() => 0 + COSTS.newPC, 0); // if we replaced everything non-OK
  const replaceCostAll = allData.filter(d => ["Upgrade","Review","Replace"].includes(d.status)).length * COSTS.newPC;
  const savings      = replaceCostAll - (upgradeCost + data.filter(d=>d.status==="Replace").reduce((s,d)=>s+d.cost,0));

  return { total, upgrades, reviews, replacements, ok, upgradeCost, replaceCostAll, savings };
}

// ── Render Summary Cards ──────────────────────────────────────
function renderCards(summary) {
  const fmt = n => `KES ${n.toLocaleString()}`;
  document.getElementById("card-total").textContent      = summary.total;
  document.getElementById("card-upgrades").textContent   = summary.upgrades + summary.reviews;
  document.getElementById("card-replacements").textContent = summary.replacements;
  document.getElementById("card-savings").textContent    = fmt(summary.savings);
  document.getElementById("card-upgrade-cost").textContent = fmt(summary.upgradeCost);
  document.getElementById("card-replace-cost").textContent = fmt(summary.replaceCostAll);
}

// ── Render Table ──────────────────────────────────────────────
const STATUS_COLOR = {
  "OK":      "badge-ok",
  "Upgrade": "badge-upgrade",
  "Replace": "badge-replace",
  "Review":  "badge-review"
};
const PRIORITY_COLOR = {
  "Critical": "priority-critical",
  "High":     "priority-high",
  "Medium":   "priority-medium",
  "Low":      "priority-low"
};

function renderTable(data) {
  const tbody = document.getElementById("asset-tbody");
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-row">No records match your filters.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map(pc => {
    const displayCost = pc.cost > 0 ? `KES ${pc.cost.toLocaleString()}` : "—";
    const rowClass    = pc.priority === "Critical" ? "row-critical" : pc.priority === "High" ? "row-high" : "";
    return `
    <tr class="${rowClass}" data-id="${pc.id}">
      <td class="td-id">${pc.id}</td>
      <td>
        <div class="td-user">${pc.user}</div>
        <div class="td-dept">${pc.department}</div>
      </td>
      <td><span class="office-badge ${pc.office === 'Thika' ? 'office-thika' : 'office-nairobi'}">${pc.office}</span></td>
      <td class="td-model">${pc.model}<br><span class="td-spec">${pc.processor} ${pc.gen} Gen · ${pc.ram}</span></td>
      <td><span class="disk-badge ${pc.diskType === 'SSD' ? 'disk-ssd' : 'disk-hdd'}">${pc.diskType}</span></td>
      <td><span class="badge ${STATUS_COLOR[pc.status]}">${pc.status}</span></td>
      <td><span class="priority-dot ${PRIORITY_COLOR[pc.priority]}"></span>${pc.priority}</td>
      <td class="td-action">${pc.action}</td>
      <td class="td-cost">${displayCost}</td>
    </tr>`;
  }).join("");
}

// ── Render Whatif Panel ───────────────────────────────────────
function renderWhatif() {
  const actionableUpgrade = allData.filter(d => ["Upgrade","Review"].includes(d.status));
  const mustReplace       = allData.filter(d => d.status === "Replace");

  const upgradeScenarioCost = actionableUpgrade.reduce((s,d) => s + d.cost, 0)
                             + mustReplace.reduce((s,d) => s + d.cost, 0);
  const replaceScenarioCost = [...actionableUpgrade, ...mustReplace].length * COSTS.newPC;
  const savedAmount  = replaceScenarioCost - upgradeScenarioCost;
  const pct = Math.round((savedAmount / replaceScenarioCost) * 100);

  document.getElementById("wi-scenario-a-cost").textContent = `KES ${upgradeScenarioCost.toLocaleString()}`;
  document.getElementById("wi-scenario-b-cost").textContent = `KES ${replaceScenarioCost.toLocaleString()}`;
  document.getElementById("wi-savings").textContent         = `KES ${savedAmount.toLocaleString()}`;
  document.getElementById("wi-pct").textContent             = `${pct}% cheaper`;
  document.getElementById("wi-upgrade-count").textContent   = actionableUpgrade.length;
  document.getElementById("wi-replace-count").textContent   = mustReplace.length;

  // Animate savings bar
  const bar = document.getElementById("savings-bar-fill");
  setTimeout(() => { bar.style.width = pct + "%"; }, 300);
}

// ── Chart Helpers ─────────────────────────────────────────────
function getChartColors() {
  return darkMode
    ? { ok:"#22c55e", upgrade:"#f59e0b", replace:"#ef4444", review:"#6366f1",
        text:"#e2e8f0", grid:"rgba(255,255,255,0.08)", upgrade2:"#3b82f6" }
    : { ok:"#22c55e", upgrade:"#f59e0b", replace:"#ef4444", review:"#6366f1",
        text:"#374151", grid:"rgba(0,0,0,0.06)", upgrade2:"#3b82f6" };
}

function initCharts() {
  buildPieChart();
  buildBarChart();
}

function buildPieChart() {
  const ctx = document.getElementById("pie-chart").getContext("2d");
  const c = getChartColors();
  const counts = {
    OK:      allData.filter(d=>d.status==="OK").length,
    Upgrade: allData.filter(d=>d.status==="Upgrade").length,
    Review:  allData.filter(d=>d.status==="Review").length,
    Replace: allData.filter(d=>d.status==="Replace").length,
  };
  if (charts.pie) charts.pie.destroy();
  charts.pie = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["OK — No Action","SSD Upgrade Needed","Review / Assess","Full Replacement"],
      datasets: [{
        data: [counts.OK, counts.Upgrade, counts.Review, counts.Replace],
        backgroundColor: [c.ok, c.upgrade, c.review, c.replace],
        borderWidth: 0,
        hoverOffset: 8
      }]
    },
    options: {
      cutout: "68%",
      plugins: {
        legend: { position:"bottom", labels:{ color:c.text, font:{size:12}, padding:16, boxWidth:12 }},
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} machines` }}
      },
      animation: { animateScale: true, duration: 800 }
    }
  });
}

function buildBarChart() {
  const ctx = document.getElementById("bar-chart").getContext("2d");
  const c = getChartColors();
  const actionable = allData.filter(d => ["Upgrade","Review","Replace"].includes(d.status));
  const upgradeTotal  = actionable.filter(d=>["Upgrade","Review"].includes(d.status)).reduce((s,d)=>s+d.cost,0);
  const replaceTotal  = actionable.length * COSTS.newPC;
  const mustReplace   = actionable.filter(d=>d.status==="Replace").reduce((s,d)=>s+d.cost,0);

  if (charts.bar) charts.bar.destroy();
  charts.bar = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Scenario A: Smart Upgrades","Scenario B: Full Replacement"],
      datasets: [{
        label: "Total Cost (KES)",
        data: [upgradeTotal + mustReplace, replaceTotal],
        backgroundColor: [c.upgrade2, c.replace],
        borderRadius: 8,
        borderSkipped: false,
        barThickness: 60
      }]
    },
    options: {
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` KES ${ctx.raw.toLocaleString()}` }}
      },
      scales: {
        x: {
          ticks: { color:c.text, callback: v => "KES "+Number(v).toLocaleString() },
          grid:  { color: c.grid }
        },
        y: { ticks: { color:c.text }, grid: { display:false }}
      },
      animation: { duration: 900 }
    }
  });
}

function refreshCharts() {
  if (charts.pie) charts.pie.destroy();
  if (charts.bar) charts.bar.destroy();
  buildPieChart();
  buildBarChart();
}

// ── Render All ────────────────────────────────────────────────
function renderAll() {
  const summary = getSummary(filteredData);
  renderCards(summary);
  renderTable(filteredData);
  renderWhatif();
}

// ── Theme ─────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem("tcm_theme");
  if (saved === "dark") enableDark();
}

function enableDark() {
  document.documentElement.classList.add("dark");
  document.getElementById("theme-icon").textContent = "☀️";
  darkMode = true;
}
function enableLight() {
  document.documentElement.classList.remove("dark");
  document.getElementById("theme-icon").textContent = "🌙";
  darkMode = false;
}

function toggleTheme() {
  darkMode ? enableLight() : enableDark();
  localStorage.setItem("tcm_theme", darkMode ? "dark" : "light");
  refreshCharts();
}

// ── Events ────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);

  // Sidebar nav
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
      item.classList.add("active");
      const target = item.dataset.target;
      document.querySelectorAll(".page").forEach(p => p.classList.remove("active-page"));
      document.getElementById("page-" + target).classList.add("active-page");
    });
  });

  // Filters
  document.getElementById("filter-status").addEventListener("change", e => {
    activeFilters.status = e.target.value; applyFilters(); renderAll();
  });
  document.getElementById("filter-priority").addEventListener("change", e => {
    activeFilters.priority = e.target.value; applyFilters(); renderAll();
  });
  document.getElementById("filter-office").addEventListener("change", e => {
    activeFilters.office = e.target.value; applyFilters(); renderAll();
  });
  document.getElementById("filter-search").addEventListener("input", e => {
    activeFilters.search = e.target.value; applyFilters(); renderAll();
  });

  // Reset filters
  document.getElementById("reset-filters").addEventListener("click", () => {
    activeFilters = { status:"All", priority:"All", office:"All", search:"" };
    document.getElementById("filter-status").value   = "All";
    document.getElementById("filter-priority").value = "All";
    document.getElementById("filter-office").value   = "All";
    document.getElementById("filter-search").value   = "";
    applyFilters(); renderAll();
  });

  // Sidebar hamburger on mobile
  document.getElementById("menu-toggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
  });

  // Table sort
  document.querySelectorAll("th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      filteredData.sort((a,b) => {
        if (a[key] < b[key]) return -1;
        if (a[key] > b[key]) return  1;
        return 0;
      });
      renderTable(filteredData);
    });
  });
}

window.addEventListener("DOMContentLoaded", init);
