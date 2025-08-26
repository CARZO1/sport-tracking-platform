const body = document.getElementById("ladderBody");
const updated = document.getElementById("updated");
const liveChip = document.getElementById("liveChip");

// fetch + render
async function load() {
  try {
    const res = await fetch("/api/standings/live");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");

    renderTable(data.rows);
    updated.textContent = `Updated ${new Date().toLocaleTimeString()} • In-progress matches: ${data.liveCount}`;
    liveChip.style.display = data.liveCount ? "inline-block" : "none";
  } catch (e) {
    updated.textContent = "Error loading table.";
    console.error(e);
  }
}

function renderTable(rows) {
  body.innerHTML = "";
  // decorate zones = 1–4 UCL, 5 Europa (simplified), bottom 3 relegation
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    const zone = i < 4 ? "ucl" : i === 4 ? "europa" : i >= rows.length - 3 ? "releg" : "";
    if (zone) tr.classList.add(zone);

    tr.innerHTML = `
      <td class="col-rank"><span class="rank">${r.rank}</span></td>
      <td class="col-club">
        <div class="club">
          <img src="${r.team.logo}" alt="">
          <span class="name">${r.team.name}</span>
        </div>
      </td>
      <td>${r.all.played}</td>
      <td>${r.all.win}</td>
      <td>${r.all.draw}</td>
      <td>${r.all.lose}</td>
      <td>${r.all.goals.for}</td>
      <td>${r.all.goals.against}</td>
      <td>${signed(r.goalsDiff)}</td>
      <td><strong>${r.points}</strong></td>
      <td>${r.gamesInHand ?? 0}</td>
    `;
    body.appendChild(tr);
  });
}

function signed(n){ return n>0?`+${n}`:`${n}`; }

load();
setInterval(load, 30_000); // refresh every 30 secs
