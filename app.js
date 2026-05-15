// TritonGym leaderboard frontend.
// Reads /api/leaderboard (or data/leaderboard.json as fallback) and renders
// a sortable, splitable, filterable, comparable table.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const SPLIT_LABELS = {
  full:     "Full Benchmark",
  standard: "Standard",
  ood:      "OOD",
  dsl:      "DSL",
};

const AGENT_ORDER = ["AlphaEvolve", "Geak", "One-shot", "Leader"];

const state = {
  data: null,
  split: "full",
  view: "flat",                   // "flat" | "agent"
  sortKey: "pass",
  sortDir: "desc",
  license: "all",                 // "all" | "open" | "proprietary"
  selectedTags: new Set(),        // active tag filter
  selectedRows: new Set(),        // row keys selected for compare
};

const rowKey = (r) => `${r.model_display}__${r.agent_display}`;

async function loadData() {
  for (const url of ["/api/leaderboard", "data/leaderboard.json"]) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (_) { /* try next */ }
  }
  throw new Error("Could not load leaderboard data");
}

function fmtPct(p)  { return (p == null || isNaN(p)) ? "—" : (p * 100).toFixed(1) + "%"; }
function fmtPerf(p) { return (p == null || isNaN(p)) ? "—" : p.toFixed(3); }

function rowSortValue(row, key) {
  if (key === "model") return row.model_display;
  if (key === "agent") return row.agent_display;
  const split = row.splits[state.split] || {};
  if (key === "pass") return split.pass ?? -1;
  if (key === "perf") return split.perf ?? -1;
  return 0;
}

function compareRows(a, b) {
  const ka = rowSortValue(a, state.sortKey);
  const kb = rowSortValue(b, state.sortKey);
  let cmp;
  if (typeof ka === "number" && typeof kb === "number") cmp = ka - kb;
  else cmp = String(ka).localeCompare(String(kb));
  return state.sortDir === "asc" ? cmp : -cmp;
}

function passesFilters(r) {
  if (state.license !== "all" && r.licensing !== state.license) return false;
  if (state.selectedTags.size > 0) {
    const tags = new Set(r.tags || []);
    let hasAny = false;
    for (const t of state.selectedTags) if (tags.has(t)) { hasAny = true; break; }
    if (!hasAny) return false;
  }
  return true;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderModelCell(r) {
  const name = escapeHtml(r.model_display);
  const linked = r.model_url
    ? `<a href="${escapeHtml(r.model_url)}" target="_blank" rel="noopener">${name}</a>`
    : name;
  const tags = (r.tags || []).map(t => `<span class="row-tag">${escapeHtml(t)}</span>`).join("");
  const lic = r.licensing
    ? `<span class="row-lic row-lic-${escapeHtml(r.licensing)}">${escapeHtml(r.licensing)}</span>`
    : "";
  return `<div class="model-cell">${linked} ${lic}${tags}</div>`;
}

function renderRow(r, rank, maxPass, showAgent) {
  const s = r.splits[state.split] || {};
  const passWidth = ((s.pass || 0) / maxPass) * 100;
  const k = rowKey(r);
  const checked = state.selectedRows.has(k) ? "checked" : "";
  return `<tr data-key="${escapeHtml(k)}">
    <td class="col-cmp"><input type="checkbox" class="row-cmp" data-key="${escapeHtml(k)}" ${checked}/></td>
    <td class="col-rank">${rank}</td>
    <td class="col-model">${renderModelCell(r)}</td>
    <td class="col-agent">${showAgent ? escapeHtml(r.agent_display) : ""}</td>
    <td class="col-pass"><div class="bar-cell"><span>${fmtPct(s.pass)}</span><div class="bar"><div class="bar-fill" style="width:${passWidth}%"></div></div></div></td>
    <td class="col-perf">${fmtPerf(s.perf)}</td>
  </tr>`;
}

function render() {
  const data = state.data;
  if (!data) return;

  const tbody = $("#lb-body");
  const rows = data.rows.filter(passesFilters);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">No rows match the current filters.</td></tr>`;
    updateCompareBar();
    return;
  }

  const maxPass = rows.reduce((m, r) => Math.max(m, r.splits[state.split]?.pass || 0), 0) || 1;

  if (state.view === "agent") {
    const groups = new Map();
    for (const r of rows) {
      const a = r.agent_display;
      if (!groups.has(a)) groups.set(a, []);
      groups.get(a).push(r);
    }
    const sortedAgents = [...groups.keys()].sort((a, b) => {
      const ia = AGENT_ORDER.indexOf(a), ib = AGENT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    tbody.innerHTML = sortedAgents.map(agent => {
      const grp = groups.get(agent).slice().sort(compareRows);
      const groupRows = grp.map((r, i) => renderRow(r, i + 1, maxPass, false)).join("");
      return `<tr class="group-header"><td colspan="6">${escapeHtml(agent)} <span class="group-count">${grp.length} model${grp.length === 1 ? "" : "s"}</span></td></tr>${groupRows}`;
    }).join("");
  } else {
    rows.sort(compareRows);
    tbody.innerHTML = rows.map((r, i) => renderRow(r, i + 1, maxPass, true)).join("");
  }

  // Wire up newly-rendered checkboxes
  $$(".row-cmp").forEach(cb => {
    cb.addEventListener("change", (e) => {
      const k = e.target.dataset.key;
      if (e.target.checked) state.selectedRows.add(k);
      else                  state.selectedRows.delete(k);
      updateCompareBar();
    });
  });

  updateCompareBar();
}

function bindControls() {
  // Split tabs (Full/Standard/OOD/DSL)
  $$("#split-tabs .tab").forEach(btn => {
    btn.addEventListener("click", () => {
      $$("#split-tabs .tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.split = btn.dataset.split;
      render();
    });
  });

  // View tabs (Flat / By Agent)
  $$("#view-tabs .tab").forEach(btn => {
    btn.addEventListener("click", () => {
      $$("#view-tabs .tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.view = btn.dataset.view;
      render();
    });
  });

  // License chips
  $$("#license-filter .chip").forEach(btn => {
    btn.addEventListener("click", () => {
      $$("#license-filter .chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.license = btn.dataset.license;
      render();
    });
  });

  // Sortable headers
  $$(".sortable").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDir = key === "pass" || key === "perf" ? "desc" : "asc";
      }
      $$(".sortable").forEach(t => {
        t.classList.remove("sort-active", "sort-desc", "sort-asc");
        const baseLabel = t.textContent.replace(/[▲▼]\s*$/, "").trim();
        t.textContent = baseLabel;
        if (t.dataset.sort === state.sortKey) {
          t.classList.add("sort-active", "sort-" + state.sortDir);
          t.textContent = baseLabel + " " + (state.sortDir === "desc" ? "▼" : "▲");
        }
      });
      render();
    });
  });

  // Compare bar buttons
  $("#compare-open-btn").addEventListener("click", openCompareModal);
  $("#compare-clear-btn").addEventListener("click", () => {
    state.selectedRows.clear();
    render();
  });
  $("#compare-close-btn").addEventListener("click", () => {
    $("#compare-modal").hidden = true;
  });
  $("#compare-modal").addEventListener("click", (e) => {
    if (e.target.id === "compare-modal") $("#compare-modal").hidden = true;
  });
}

function buildTagFilter(data) {
  const allTags = new Set();
  data.rows.forEach(r => (r.tags || []).forEach(t => allTags.add(t)));
  if (allTags.size === 0) {
    $("#tag-filter").hidden = true;
    return;
  }
  const container = $("#tag-filter");
  for (const t of [...allTags].sort()) {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.dataset.tag = t;
    btn.textContent = t;
    btn.addEventListener("click", () => {
      if (state.selectedTags.has(t)) {
        state.selectedTags.delete(t);
        btn.classList.remove("active");
      } else {
        state.selectedTags.add(t);
        btn.classList.add("active");
      }
      render();
    });
    container.appendChild(btn);
  }
}

function updateCompareBar() {
  const n = state.selectedRows.size;
  const inline = $("#compare-inline");
  const btn = $("#compare-open-btn");
  $("#compare-count").textContent = n;
  inline.hidden = n === 0;
  btn.disabled = n < 2;
  btn.title = n < 2 ? "Select 2+ models to compare" : `Compare ${n} models`;
}

function openCompareModal() {
  const rows = state.data.rows.filter(r => state.selectedRows.has(rowKey(r)));
  if (rows.length < 2) return;
  const splitOrder = ["standard", "ood", "dsl", "full"];

  // Header row: model + agent for each selected row
  const head = `<tr>
    <th></th>
    ${rows.map(r => `<th>
      ${escapeHtml(r.model_display)}<br/>
      <span class="cmp-sub">${escapeHtml(r.agent_display)}</span>
    </th>`).join("")}
  </tr>`;

  // Metric rows
  const metricRows = [];
  for (const sp of splitOrder) {
    metricRows.push(`<tr>
      <th class="cmp-row-label">${SPLIT_LABELS[sp]} — Pass@1</th>
      ${rows.map(r => `<td>${fmtPct(r.splits[sp]?.pass)}</td>`).join("")}
    </tr>`);
    metricRows.push(`<tr>
      <th class="cmp-row-label">${SPLIT_LABELS[sp]} — Perf@1</th>
      ${rows.map(r => `<td>${fmtPerf(r.splits[sp]?.perf)}</td>`).join("")}
    </tr>`);
  }

  // Meta rows (license, tags)
  metricRows.push(`<tr>
    <th class="cmp-row-label">License</th>
    ${rows.map(r => `<td>${r.licensing ? `<span class="row-lic row-lic-${escapeHtml(r.licensing)}">${escapeHtml(r.licensing)}</span>` : "—"}</td>`).join("")}
  </tr>`);
  metricRows.push(`<tr>
    <th class="cmp-row-label">Tags</th>
    ${rows.map(r => `<td>${(r.tags || []).map(t => `<span class="row-tag">${escapeHtml(t)}</span>`).join(" ") || "—"}</td>`).join("")}
  </tr>`);

  $("#compare-body").innerHTML = `<table class="cmp-table"><thead>${head}</thead><tbody>${metricRows.join("")}</tbody></table>`;
  $("#compare-modal").hidden = false;
}

function setHeroStats(data) {
  const totalOps = (data.splits.standard?.size || 0) + (data.splits.ood?.size || 0) + (data.splits.dsl?.size || 0);
  $("#stat-ops").textContent = totalOps;
  const models = new Set(data.rows.map(r => r.model_display));
  $("#stat-models").textContent = models.size;
  const agents = new Set(data.rows.map(r => r.agent_display));
  $("#stat-agents").textContent = agents.size;
}

function bindCiteCopy() {
  const btn = document.getElementById("cite-copy-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const text = document.getElementById("cite-code").innerText;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("copied");
      }, 1600);
    } catch (_) {
      btn.textContent = "Failed";
      setTimeout(() => { btn.textContent = "Copy"; }, 1600);
    }
  });
}

(async function init() {
  bindControls();
  bindCiteCopy();
  try {
    state.data = await loadData();
    setHeroStats(state.data);
    buildTagFilter(state.data);
    render();
  } catch (e) {
    $("#lb-body").innerHTML = `<tr><td colspan="6" class="empty">Could not load leaderboard data: ${escapeHtml(e.message)}</td></tr>`;
  }
})();
