import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3001;

const API = "https://api-football-v1.p.rapidapi.com/v3";
const HEADERS = {
  "x-rapidapi-key": process.env.RAPIDAPI_KEY || "09fcb6067abdffa957bfb561880a0155",
  "x-rapidapi-host": "api-football-v1.p.rapidapi.com",
};
const LEAGUE = 39;    // Premier League
const SEASON = 2025;

let cache = {};
const getCache = (k, ttl = 30_000) =>
  cache[k] && Date.now() - cache[k].t < ttl ? cache[k].v : null;
const setCache = (k, v) => (cache[k] = { t: Date.now(), v });

async function api(path) {
  const res = await fetch(`${API}${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(res.statusText);
  const j = await res.json();
  return j.response;
}

async function getStandings() {
  const hit = getCache("standings");
  if (hit) return hit;
  const r = await api(`/standings?league=${LEAGUE}&season=${SEASON}`);
  const table = r[0].league.standings[0];
  setCache("standings", table);
  return table;
}

async function getLiveFixtures() {
  const hit = getCache("live");
  if (hit) return hit;
  const r = await api(`/fixtures?live=all&league=${LEAGUE}&season=${SEASON}`);
  setCache("live", r);
  return r;
}

function addGamesInHand(rows) {
  const maxP = Math.max(...rows.map(r => r.all.played));
  return rows.map(r => ({ ...r, gamesInHand: maxP - r.all.played }));
}

function applyLive(base, fixtures) {
  const byId = new Map(base.map(r => [r.team.id, JSON.parse(JSON.stringify(r))]));

  for (const fx of fixtures) {
    const h = byId.get(fx.teams.home.id);
    const a = byId.get(fx.teams.away.id);
    if (!h || !a) continue;
    const hs = fx.goals.home ?? 0, as = fx.goals.away ?? 0;

    h.all.played += 1; a.all.played += 1;
    h.all.goals.for += hs; h.all.goals.against += as;
    a.all.goals.for += as; a.all.goals.against += hs;

    if (hs > as) { h.points += 3; h.all.win++; a.all.lose++; }
    else if (hs < as) { a.points += 3; a.all.win++; h.all.lose++; }
    else { h.points++; a.points++; h.all.draw++; a.all.draw++; }

    h.goalsDiff = h.all.goals.for - h.all.goals.against;
    a.goalsDiff = a.all.goals.for - a.all.goals.against;
  }

  const rows = [...byId.values()].sort((x, y) =>
    y.points - x.points ||
    y.goalsDiff - x.goalsDiff ||
    y.all.goals.for - x.all.goals.for ||
    x.team.name.localeCompare(y.team.name)
  );
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

app.use(express.static("public")); // to serve your HTML/CSS/JS

app.get("/api/standings/live", async (req, res) => {
  try {
    const [base, live] = await Promise.all([getStandings(), getLiveFixtures()]);
    const adjusted = addGamesInHand(applyLive(base, live));
    res.json({ season: SEASON, liveCount: live.length, rows: adjusted });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
