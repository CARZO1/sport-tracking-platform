document.addEventListener("DOMContentLoaded", () => {
  load();
  // refresh every 60s
  setInterval(load, 60_000);
});

async function load() {
  const updated = document.getElementById("updated");
  try {
    const res = await fetch("/api/standings/live", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load standings");

    // set season badge like "2025–26"
    setSeasonBadge(data.seasonUsed);

    // render table rows
    render(data.rows);

    // updated text + live chip
    const liveChip = document.getElementById("liveChip");
    if (liveChip) {
      liveChip.style.display = data.liveCount ? "inline-block" : "none";
      liveChip.textContent = `LIVE ${data.liveCount}`;
    }

    if (updated) {
      const note = data.source === "football-data" ? "" : ` • source: ${data.source}`;
      updated.textContent = `Updated ${new Date().toLocaleTimeString()} • In-progress matches: ${data.liveCount}${note}`;
    }
  } catch (e) {
    console.error(e);
    if (updated) updated.textContent = "Error loading table.";
    render([]); // empty state
  }
}

function setSeasonBadge(year) {
  const el = document.getElementById("seasonBadge");
  if (!el || !year) return;
  const nextShort = String((year + 1)).slice(-2);
  el.textContent = `${year}–${nextShort}`;
}

function render(rows) {
  const body = document.getElementById("ladderBody");
  if (!body) return;
  body.innerHTML = "";

  if (!rows || rows.length === 0) {
    body.innerHTML = `<tr><td class="muted" colspan="10">No standings available.</td></tr>`;
    return;
  }

  rows.forEach((r, i) => {
    const tr = document.createElement("tr");

    const zone = i < 4 ? "ucl" : i === 4 ? "europa" : i >= rows.length - 3 ? "releg" : "";
    if (zone) tr.classList.add(zone);

    const crest = r.team.logo || "";
    const gd = r.goalsDiff > 0 ? `+${r.goalsDiff}` : r.goalsDiff;

    tr.innerHTML = `
      <td class="col-rank"><span class="rank">${r.rank}</span></td>
      <td class="col-club">
        <div class="club">
          <img class="crest" loading="lazy" src="${crest}" alt="${escapeHtml(r.team.name)} crest"
               onerror="this.onerror=null; this.src='https://upload.wikimedia.org/wikipedia/commons/e/e9/Football_iu_1996.svg'">
          <span class="name">${escapeHtml(r.team.name)}</span>
        </div>
      </td>
      <td>${r.all.played}</td>
      <td>${r.all.win}</td>
      <td>${r.all.draw}</td>
      <td>${r.all.lose}</td>
      <td>${r.all.goals.for}</td>
      <td>${r.all.goals.against}</td>
      <td>${gd}</td>
      <td><strong>${r.points}</strong></td>
    `;
    body.appendChild(tr);
  });
}

// tiny HTML escaper for safety
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
