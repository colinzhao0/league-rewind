require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const RIOT_API_KEY = process.env.RIOT_API_KEY;
const riotApi = axios.create({
  headers: {
    'X-Riot-Token': RIOT_API_KEY,
  },
});

const errorHandler = (error, res) => {
  console.error('Riot API Error:', error.response ? error.response.data : error.message);
  if (res) {
    if (error.response) {
      const { status } = error.response;
      if (status === 404) {
        res.status(404).json({ error: 'User not found' });
      } else if (status === 429) {
        res.status(429).json({ error: 'Rate limited' });
      } else if (status === 401 || status === 403) {
        res.status(403).json({ error: 'Invalid API key' });
      } else {
        res.status(status).json({ error: 'An error occurred' });
      }
    } else {
      res.status(500).json({ error: 'An internal server error occurred' });
    }
  }
};

const getPlatformId = (region) => {
  switch (region) {
    case 'americas':
      return 'na1';
    case 'europe':
      return 'euw1';
    case 'asia':
      return 'kr';
    default:
      return 'na1';
  }
};

app.get('/api/puuid', async (req, res) => {
  const { gameName, tagLine, region } = req.query;
  const processedTagLine = tagLine.startsWith('#') ? tagLine.slice(1) : tagLine;
  try {
    const { data } = await riotApi.get(`https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${gameName}/${processedTagLine}`);
    res.json(data);
  } catch (error) {
    errorHandler(error, res);
  }
});

app.get('/api/account', async (req, res) => {
  const { puuid, region } = req.query;
  try {
    const { data } = await riotApi.get(`https://${region}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}`);
    res.json(data);
  } catch (error) {
    errorHandler(error, res);
  }
});

app.get('/api/champion-mastery', async (req, res) => {
  const { puuid, region } = req.query;
  const platformId = getPlatformId(region);
  try {
    const { data } = await riotApi.get(`https://${platformId}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}`);
    res.json(data);
  } catch (error) {
    errorHandler(error, res);
  }
});

app.get('/api/matches', async (req, res) => {
  const { puuid, region } = req.query;
  const seasonStartTimestamp = Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000);
  let allMatchIds = [];
  let start = 0;
  const count = 100;
  let hasMore = true;

  try {
    while (hasMore) {
      const { data: matchIds } = await riotApi.get(`https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids`, {
        params: { startTime: seasonStartTimestamp, start, count },
      });
      if (matchIds.length > 0) {
        allMatchIds = allMatchIds.concat(matchIds);
        start += count;
      } else {
        hasMore = false;
      }
      if (matchIds.length < count) {
        hasMore = false;
      }
    }
    res.json(allMatchIds);
  } catch (error) {
    errorHandler(error, res);
  }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const processMatches = async (ws, { matchIds, puuid, region }) => {
  // --- Overall Stats ---
  let totalKills = 0;
  let totalDeaths = 0;
  let totalAssists = 0;
  let totalTimeDead = 0;
  let kills = { pentaKills: 0, quadraKills: 0, tripleKills: 0, doubleKills: 0 };
  let roles = {};
  let wins = 0;
  let losses = 0;

  // --- Game Highlights ---
  let mostKillsGame = { kills: -1, championName: '', deaths: 0, assists: 0 };
  let mostDeathsGame = { deaths: -1, championName: '', kills: 0, assists: 0 };
  let bestKdaGame = null; // will store games with deaths > 0 only

  // --- Persona Stats ---
  let personaStats = {
    totalDamageDealtToChampions: 0,
    totalDamageTaken: 0,
    visionScore: 0,
    damageDealtToObjectives: 0,
  };

  // --- Duo Partner Stats ---
  let teammates = {}; // { puuid: { games: 0, wins: 0 } }

  let processedCount = 0;

  for (const matchId of matchIds) {
    let matchData;
    let success = false;
    while (!success) {
      try {
        const response = await riotApi.get(`https://${region}.api.riotgames.com/lol/match/v5/matches/${matchId}`);
        matchData = response.data;
        success = true;
      } catch (error) {
        if (error.response && error.response.status === 429) {
          const retryAfter = parseInt(error.response.headers['retry-after']) || 1;
          console.log(`Rate limited. Retrying after ${retryAfter} seconds...`);
          ws.send(JSON.stringify({ type: 'status', message: `Rate limited. Retrying in ${retryAfter}s...` }));
          await sleep(retryAfter * 1000);
        } else {
          throw error;
        }
      }
    }

    const mainParticipant = matchData.info.participants.find(p => p.puuid === puuid);
    if (mainParticipant) {
      // --- Aggregate Stats ---
      totalKills += mainParticipant.kills;
      totalDeaths += mainParticipant.deaths;
      totalAssists += mainParticipant.assists;
      totalTimeDead += mainParticipant.totalTimeSpentDead;
      kills.pentaKills += mainParticipant.pentaKills;
      kills.quadraKills += mainParticipant.quadraKills;
      kills.tripleKills += mainParticipant.tripleKills;
      kills.doubleKills += mainParticipant.doubleKills;
      const role = mainParticipant.teamPosition;
      roles[role] = (roles[role] || 0) + 1;
      if (mainParticipant.win) {
        wins++;
      } else {
        losses++;
      }

      // --- Persona Stats ---
      personaStats.totalDamageDealtToChampions += mainParticipant.totalDamageDealtToChampions;
      personaStats.totalDamageTaken += mainParticipant.totalDamageTaken;
      personaStats.visionScore += mainParticipant.visionScore;
      personaStats.damageDealtToObjectives += mainParticipant.damageDealtToObjectives;

      // --- Game Highlights ---
      if (mainParticipant.kills > mostKillsGame.kills) {
        mostKillsGame = { kills: mainParticipant.kills, deaths: mainParticipant.deaths, assists: mainParticipant.assists, championName: mainParticipant.championName };
      }
      if (mainParticipant.deaths > mostDeathsGame.deaths) {
        mostDeathsGame = { kills: mainParticipant.kills, deaths: mainParticipant.deaths, assists: mainParticipant.assists, championName: mainParticipant.championName };
      }

      // --- Best KD (ignore games with 0 deaths) ---
      if (typeof mainParticipant.deaths === 'number' && mainParticipant.deaths > 0) {
        const kd = mainParticipant.kills / mainParticipant.deaths;
        if (!bestKdaGame) {
          bestKdaGame = { kd, kills: mainParticipant.kills, deaths: mainParticipant.deaths, assists: mainParticipant.assists, championName: mainParticipant.championName };
        } else {
          if (kd > bestKdaGame.kd) {
            bestKdaGame = { kd, kills: mainParticipant.kills, deaths: mainParticipant.deaths, assists: mainParticipant.assists, championName: mainParticipant.championName };
          } else if (kd === bestKdaGame.kd) {
            // tie-breaker: prefer higher kills
            if (mainParticipant.kills > bestKdaGame.kills) {
              bestKdaGame = { kd, kills: mainParticipant.kills, deaths: mainParticipant.deaths, assists: mainParticipant.assists, championName: mainParticipant.championName };
            }
          }
        }
      }

      // --- Duo Partner ---
      const playerTeam = matchData.info.participants.filter(p => p.teamId === mainParticipant.teamId && p.puuid !== puuid);
      for (const teammate of playerTeam) {
        if (!teammates[teammate.puuid]) {
          teammates[teammate.puuid] = { games: 0, wins: 0 };
        }
        teammates[teammate.puuid].games++;
        if (mainParticipant.win) {
          teammates[teammate.puuid].wins++;
        }
      }
    }
    
    processedCount++;
    ws.send(JSON.stringify({ type: 'progress', processed: processedCount, total: matchIds.length }));
    await sleep(100);
  }

  // --- Final Calculations ---
  const totalKda = (totalKills + totalAssists) / (totalDeaths || 1);
  const mostCommonRole = Object.keys(roles).length > 0 ? Object.keys(roles).reduce((a, b) => roles[a] > roles[b] ? a : b) : 'UNKNOWN';
  
  // --- Determine Persona ---
  let playerPersona = 'The All-Rounder';
  const personaEntries = Object.entries(personaStats);
  if (personaEntries.length > 0) {
    const topStat = personaEntries.reduce((a, b) => a[1] > b[1] ? a : b)[0];
    switch (topStat) {
      case 'totalDamageDealtToChampions': playerPersona = 'The Carry'; break;
      case 'totalDamageTaken': playerPersona = 'The Unkillable Tank'; break;
      case 'visionScore': playerPersona = 'The Visionary'; break;
      case 'damageDealtToObjectives': playerPersona = 'The Objective Fiend'; break;
    }
  }

  // --- Find Best Duo ---
  let bestDuo = null;
  const potentialDuos = Object.entries(teammates).filter(([puuid, data]) => data.games >= 5); // Min 5 games to be a duo
  if (potentialDuos.length > 0) {
    const bestDuoPuuid = potentialDuos.reduce((a, b) => {
      const winRateA = a[1].wins / a[1].games;
      const winRateB = b[1].wins / b[1].games;
      return winRateA > winRateB ? a : b;
    })[0];
    
    const duoData = teammates[bestDuoPuuid];
    bestDuo = { puuid: bestDuoPuuid, games: duoData.games, winRate: (duoData.wins / duoData.games) * 100 };
  }

  ws.send(JSON.stringify({ 
    type: 'complete', 
    data: { 
      mostCommonRole, 
      kills,
      totalKda: totalKda.toFixed(2),
      totalTimeDead,
      mostKillsGame,
      mostDeathsGame,
  bestKdaGame,
      playerPersona,
      bestDuo,
      wins,
      losses,
    } 
  }));
};

wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.on('message', (message) => {
    const data = JSON.parse(message);
    if (data.type === 'startAnalysis') {
      processMatches(ws, data.payload).catch(err => {
        console.error('Error during match processing:', err);
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to analyze matches' }));
      });
    }
  });
  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

app.post('/api/resolve-puuid', async (req, res) => {
  const { puuid, region } = req.body;
  try {
    const { data } = await riotApi.get(`https://${region}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}`);
    res.json({ gameName: data.gameName, tagLine: data.tagLine });
  } catch (error) {
    // Don't use the main errorHandler, just send a generic failure
    res.status(500).json({ error: 'Failed to resolve PUUID' });
  }
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
