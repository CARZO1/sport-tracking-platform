import "dotenv/config";
import express from "express";

const app = express();
const PORT = process.env.PORT || 3001;

const FD_API = "https://api.football-data.org/v4";
const FD_HEADERS = {
  "X-Auth-Token": process.env.FD_TOKEN || "",
};

// ---- tiny in-memory cache ----
let cache = {};
const now = () => Date.now();
const getCache = (k, ttlMs = 120_000) =>
  cache[k] && now() - cache[k].t < ttlMs ? cache[k].v : null;
const setCache = (k, v) => (cache[k] = { t: now(), v });

// ---- fetch helpers ----
async function fd(path) {
  const res = await fetch(`${FD_API}${path}`, { headers: FD_HEADERS });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("FD error:", res.status, text || res.statusText);
    const err = new Error(text || res.statusText);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ---- shape adapters ----
// Football-Data standings: json.standings[0].table is an array of:
// { position, team: {id,name,crest}, playedGames, won, draw, lost, goalsFor, goalsAgainst, goalDifference, points }
function mapFDTableToUI(fdTable) {
  return fdTable.map((row) => ({
    rank: row.position,
    team: { id: row.team.id, name: row.team.name, logo: row.team.crest },
    points: row.points,
    goalsDiff: row.goalDifference,
    all: {
      played: row.playedGames,
      win: row.won,
      draw: row.draw,
      lose: row.lost,
      goals: { for: row.goalsFor, against: row.goalsAgainst },
    },
  }));
}

function addGamesInHand(rows) {
  const maxPlayed = Math.max(...rows.map((r) => r.all.played));
  return rows.map((r) => ({ ...r, gamesInHand: maxPlayed - r.all.played }));
}

// We’ll try to apply live in-match adjustments using current live matches.
// On free tier, live coverage can be limited; this will gracefully do nothing if none are returned.
function applyLiveAdjustments(baseRows, liveMatches) {
  if (!Array.isArray(liveMatches) || liveMatches.length === 0) return baseRows;

  const byId = new Map(baseRows.map((r) => [r.team.id, JSON.parse(JSON.stringify(r))]));

  for (const m of liveMatches) {
    const home = m.homeTeam;
    const away = m.awayTeam;
    const score = m.score?.fullTime ?? m.score?.halfTime ?? m.score?.regularTime ?? {};
    // football-data live scoring is exposed under m.score with breakdowns; live may surface under score.live or score.fullTime during IN_PLAY
    const hs = Number(score.home ?? m.score?.fullTime?.home ?? 0) || 0;
    const as = Number(score.away ?? m.score?.fullTime?.away ?? 0) || 0;

    const H = byId.get(home.id);
    const A = byId.get(away.id);
    if (!H || !A) continue;

    // Provisional: count as if match ended with current score
    H.all.played += 1; A.all.played += 1;
    H.all.goals.for += hs; H.all.goals.against += as;
    A.all.goals.for += as; A.all.goals.against += hs;

    if (hs > as) { H.points += 3; H.all.win++; A.all.lose++; }
    else if (hs < as) { A.points += 3; A.all.win++; H.all.lose++; }
    else { H.points += 1; A.points += 1; H.all.draw++; A.all.draw++; }

    H.goalsDiff = H.all.goals.for - H.all.goals.against;
    A.goalsDiff = A.all.goals.for - A.all.goals.against;
  }

  const rows = [...byId.values()].sort(
    (x, y) =>
      y.points - x.points ||
      y.goalsDiff - x.goalsDiff ||
      y.all.goals.for - x.all.goals.for ||
      x.team.name.localeCompare(y.team.name)
  );
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

// ---- domain functions ----

// Base standings (current season). We only need the "PL" competition and the first "TOTAL" table.
async function getStandingsPL() {
  const hit = getCache("fd:standings", 180_000); // 3 min
  if (hit) return hit;

  // /competitions/PL/standings -> current season standings
  const j = await fd(`/competitions/PL/standings`);
  const comp = j?.competition?.name || "Premier League";
  const seasonStart = j?.season?.startDate; // e.g., "2025-08-15"
  const seasonYear = Number((seasonStart || "").slice(0, 4)) || j?.season?.year || null;

  // Find the TOTAL table
  const total = (j.standings || []).find((s) => s.type === "TOTAL")?.table || [];
  const mapped = mapFDTableToUI(total);
  const withGIH = addGamesInHand(mapped);

  const payload = {
    competition: comp,
    seasonUsed: seasonYear,
    rows: withGIH,
  };
  setCache("fd:standings", payload);
  return payload;
}

// Live matches for PL; try to fetch matches in LIVE/IN_PLAY status
async function getLiveMatchesPL() {
  const hit = getCache("fd:live", 60_000); // 1 min
  if (hit) return hit;

  // /competitions/PL/matches?status=LIVE works; some accounts also expose IN_PLAY/PAUSED
  // We’ll try LIVE first; if nothing, also fetch IN_PLAY.
  const live = await fd(`/competitions/PL/matches?status=LIVE`).catch(() => ({ matches: [] }));
  let matches = live?.matches || [];

  if (!matches.length) {
    const inPlay = await fd(`/competitions/PL/matches?status=IN_PLAY`).catch(() => ({ matches: [] }));
    matches = inPlay?.matches || [];
  }

  setCache("fd:live", matches);
  return matches;
}

// ---- static site ----
app.use(express.static("public"));

// Health check
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, hasKey: Boolean(process.env.FD_TOKEN) });
});

// Base standings (no live adjustments)
app.get("/api/standings", async (req, res) => {
  try {
    const data = await getStandingsPL();
    res.json({ seasonUsed: data.seasonUsed, source: "football-data", rows: data.rows });
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ error: String(e) });
  }
});

// Live/provisional standings (apply live match adjustments if any)
app.get("/api/standings/live", async (req, res) => {
  try {
    const base = await getStandingsPL();
    const liveMatches = await getLiveMatchesPL(); // may be empty on free tier if no live coverage right now
    const adjusted = applyLiveAdjustments(base.rows, liveMatches);
    res.json({
      league: "PL",
      seasonUsed: base.seasonUsed,
      source: "football-data",
      liveCount: liveMatches.length,
      rateLimited: false,
      rows: adjusted,
    });
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ error: String(e) });
  }
});

// Debug – see raw FD standings
app.get("/api/debug/fd-standings-raw", async (req, res) => {
  try {
    const j = await fd(`/competitions/PL/standings`);
    res.json({ keys: Object.keys(j), sampleType: j?.standings?.[0]?.type, sampleLen: j?.standings?.[0]?.table?.length || 0 });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e) });
  }
});

// Debug – live matches (counts by status)
app.get("/api/debug/fd-live", async (req, res) => {
  try {
    const live = await getLiveMatchesPL();
    const byStatus = live.reduce((m, x) => {
      const k = x.status || x?.score?.duration || "UNK";
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {});
    res.json({ liveCount: live.length, byStatus, sampleIds: live.slice(0, 5).map(m => m.id) });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
