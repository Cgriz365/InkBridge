const functions = require("firebase-functions");
const { defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const { FieldValue } = require("firebase-admin/firestore");
const ical = require("node-ical");

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// CONSTANTS
const APP_ID = "default-app-id";

// --- SPOTIFY CONFIGURATION ---
const SPOTIFY_CLIENT_ID = defineString("SPOTIFY_CLIENT_ID");
const SPOTIFY_CLIENT_SECRET = defineString("SPOTIFY_CLIENT_SECRET");
const WEATHERAPI_KEY = defineString("WEATHERAPI_KEY");
const FINNHUB_API_KEY = defineString("FINNHUB_API_KEY");
const GOOGLE_MAPS_API_KEY = defineString("GOOGLE_MAPS_API_KEY");
const NEWS_API_KEY = defineString("NEWS_API_KEY");

const getSpotifyRedirectUri = () => {
  return `https://us-central1-${process.env.GCLOUD_PROJECT || "inkbase01"}.cloudfunctions.net/api/spotify/callback`;
};

// --- DATA PROVIDERS ---
const refreshSpotifyToken = async (uid, refreshToken) => {
  console.log(`Refreshing Spotify token for UID: ${uid}`);
  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', refreshToken);

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID.value() + ':' + SPOTIFY_CLIENT_SECRET.value()).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Failed to refresh Spotify token: ${response.status} ${errText}`);
    throw new Error('Failed to refresh Spotify token');
  }

  const data = await response.json();
  const updates = {
    spotify_access_token: data.access_token,
    spotify_token_expiry: Date.now() + (data.expires_in * 1000)
  };
  if (data.refresh_token) updates.spotify_refresh_token = data.refresh_token;

  await db.collection('artifacts').doc(APP_ID)
    .collection('users').doc(uid)
    .collection('settings').doc('integrations')
    .set(updates, { merge: true });
  console.log(`Spotify token refreshed successfully for UID: ${uid}`);

  return data.access_token;
};

const makeSpotifyRequest = async (uid, endpoint, method = "GET", body = null) => {
  const settingsRef = db.collection("artifacts").doc(APP_ID)
    .collection("users").doc(uid)
    .collection("settings").doc("integrations");

  const docSnap = await settingsRef.get();
  if (!docSnap.exists) throw new Error("User settings not found");

  let { spotify_access_token, spotify_refresh_token, spotify_token_expiry } = docSnap.data();

  if (!spotify_access_token || !spotify_refresh_token) {
    throw new Error("Spotify not connected");
  }

  // Check if token is expired or expiring in the next 5 minutes
  if (Date.now() > (spotify_token_expiry - 300000)) {
    console.log(`Token expired for ${uid}, refreshing...`);
    spotify_access_token = await refreshSpotifyToken(uid, spotify_refresh_token);
  }

  const options = {
    method: method,
    headers: {
      "Authorization": `Bearer ${spotify_access_token}`,
      "Content-Type": "application/json",
    },
  };

  if (body) options.body = JSON.stringify(body);

  const cleanEndpoint = endpoint.startsWith("/") ? endpoint.substring(1) : endpoint;
  const response = await fetch(`https://api.spotify.com/v1/${cleanEndpoint}`, options);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Spotify API Error ${response.status}: ${errText}`);
  }

  if (response.status === 204) return {};
  return await response.json();
};

// --- ROUTE: DEVICE SETUP ---
app.get('/setup', async (req, res) => {
  try {
    const deviceId = req.headers['x-device-id'] || req.query.device_id;
    if (!deviceId) return res.status(400).json({ status: "error", message: "Missing Device ID" });

    const deviceRef = db.collection('artifacts').doc(APP_ID).collection('devices').doc(deviceId);
    const deviceSnap = await deviceRef.get();

    if (!deviceSnap.exists) {
      return res.json({ status: "pending", message: "Device not registered." });
    }

    // NEW: Update lastHandshake to verify connection
    await deviceRef.update({
      lastHandshake: FieldValue.serverTimestamp()
    });

    const deviceData = deviceSnap.data();
    return res.json({
      status: "success",
      api_key: deviceData.apiKey,
      friendly_user_id: deviceData.friendlyUserId || "User",
      message: "Setup successful"
    });
  } catch (error) {
    console.error("Setup Error:", error);
    res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
});

// --- ROUTE: SPOTIFY AUTH ---
app.get('/spotify/login', (req, res) => {
  const uid = req.query.uid;
  console.log(`Initiating Spotify login for UID: ${uid}`);
  const redirectUrl = req.query.redirect || "http://localhost:5173";
  if (!uid) return res.status(400).send("Missing UID");

  const scope = 'user-read-playback-state user-read-currently-playing';
  const state = JSON.stringify({ uid, redirectUrl });

  const query = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID.value(),
    scope: scope,
    redirect_uri: getSpotifyRedirectUri(),
    state: state
  });

  res.redirect('https://accounts.spotify.com/authorize?' + query.toString());
});

app.get('/spotify/callback', async (req, res) => {
  console.log("Received Spotify callback");
  const code = req.query.code || null;
  const state = req.query.state || null;

  if (state === null || code === null) {
    console.error("Spotify callback missing state or code");
    return res.redirect('/?error=state_mismatch');
  }

  const { uid, redirectUrl } = JSON.parse(state);
  console.log(`Processing callback for UID: ${uid}, Redirect: ${redirectUrl}`);

  try {
    const params = new URLSearchParams();
    params.append('code', code);
    params.append('redirect_uri', getSpotifyRedirectUri());
    params.append('grant_type', 'authorization_code');

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID.value() + ':' + SPOTIFY_CLIENT_SECRET.value()).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Spotify Token Exchange Failed: ${response.status} ${errText}`);
      throw new Error('Spotify Token Exchange Failed');
    }
    const data = await response.json();

    await db.collection('artifacts').doc(APP_ID).collection('users').doc(uid).collection('settings').doc('integrations')
      .set({ spotify_access_token: data.access_token, spotify_refresh_token: data.refresh_token, spotify_token_expiry: Date.now() + (data.expires_in * 1000), spotify_enabled: true }, { merge: true });

    console.log("Spotify token exchange successful, redirecting...");
    res.redirect(redirectUrl);
  } catch (error) { console.error("Spotify Auth Error:", error); res.status(500).send("Authentication Error"); }
});

app.post("/spotify/request", async (req, res) => {
  try {
    const { uid, endpoint, method, body } = req.body;
    if (!uid || !endpoint) {
      return res.status(400).json({ status: "error", message: "Missing uid or endpoint" });
    }
    const data = await makeSpotifyRequest(uid, endpoint, method, body);
    res.json({ status: "success", data });
  } catch (error) {
    console.error("Spotify Proxy Error:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
});

// --- ROUTE: CALENDAR ---
app.post("/calendar", async (req, res) => {
  try {
    const { uid, range, url } = req.body;
    if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

    const settingsRef = db.collection("artifacts").doc(APP_ID)
      .collection("users").doc(uid)
      .collection("settings").doc("integrations");

    const docSnap = await settingsRef.get();
    if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

    const { ical_url, calendar_range } = docSnap.data();
    const queryUrl = url || ical_url;
    if (!queryUrl) return res.status(400).json({ status: "error", message: "Calendar not connected" });

    const events = await ical.async.fromURL(queryUrl);
    const now = new Date();
    let endLimit = new Date();

    const useRange = range || calendar_range || "1d";

    if (useRange === "1m") endLimit.setMonth(now.getMonth() + 1);
    else if (useRange === "1w") endLimit.setDate(now.getDate() + 7);
    else if (useRange === "3d") endLimit.setDate(now.getDate() + 3);
    else endLimit.setDate(now.getDate() + 1); // Default 1d

    const results = [];
    for (const event of Object.values(events)) {
      if (event.type !== "VEVENT" || !event.start) continue;

      const startDate = new Date(event.start);
      const endDate = event.end ? new Date(event.end) : new Date(startDate.getTime() + 3600000);
      const duration = endDate.getTime() - startDate.getTime();

      if (event.rrule) {
        const searchStart = new Date(now.getTime() - duration);
        try {
          const dates = event.rrule.between(searchStart, endLimit, true);
          dates.forEach((date) => {
            const instanceStart = new Date(date);
            const instanceEnd = new Date(instanceStart.getTime() + duration);
            if (instanceEnd >= now && instanceStart <= endLimit) {
              results.push({ summary: event.summary, start: instanceStart, end: instanceEnd, location: event.location });
            }
          });
        } catch (e) { console.error(`RRule Error for ${event.summary}:`, e); }
      } else if (endDate >= now && startDate <= endLimit) {
        results.push({ summary: event.summary, start: startDate, end: endDate, location: event.location });
      }
    }

    const upcoming = results
      .map(e => ({
        summary: e.summary,
        start: e.start.toISOString(),
        end: e.end.toISOString(),
        location: e.location || null
      }))
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    res.json({ status: "success", data: upcoming });
  } catch (error) {
    console.error("Calendar Error:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
});

// --- ROUTE: CANVAS ---
app.post("/canvas", async (req, res) => {
  try {
    const { uid, type, domain, token } = req.body;
    if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

    const settingsRef = db.collection("artifacts").doc(APP_ID)
      .collection("users").doc(uid)
      .collection("settings").doc("integrations");

    const docSnap = await settingsRef.get();
    if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

    let { canvas_token, canvas_domain } = docSnap.data();

    const queryToken = token || canvas_token;
    let queryDomain = domain || canvas_domain;

    if (!queryToken || !queryDomain) return res.status(400).json({ status: "error", message: "Canvas not connected" });

    // Clean domain input
    queryDomain = queryDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

    if (type === "grades") {
      const response = await fetch(`https://${queryDomain}/api/v1/courses?enrollment_state=active&include[]=total_scores`, {
        headers: { "Authorization": `Bearer ${queryToken}` }
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Canvas API Error ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const grades = data.map(course => ({
        course: course.name,
        grade: course.enrollments?.[0]?.computed_current_score || "N/A",
        letter: course.enrollments?.[0]?.computed_current_grade || "N/A"
      }));
      return res.json({ status: "success", data: grades });
    }

    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // Next 7 days
    const params = new URLSearchParams({ start_date: startDate, end_date: endDate, order: "asc" });

    const response = await fetch(`https://${queryDomain}/api/v1/planner/items?${params}`, {
      headers: { "Authorization": `Bearer ${queryToken}` }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Canvas API Error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const assignments = data.map(item => ({
      id: item.plannable_id, title: item.plannable.title, due_at: item.plannable.due_at, type: item.plannable_type
    }));

    res.json({ status: "success", data: assignments });
  } catch (error) {
    console.error("Canvas Error:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
});

// --- ROUTE: WEATHER ---
app.post("/weather", async (req, res) => {
  try {
    const { uid, location } = req.body;
    if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

    const settingsRef = db.collection("artifacts").doc(APP_ID)
      .collection("users").doc(uid)
      .collection("settings").doc("integrations");

    const docSnap = await settingsRef.get();
    if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

    const { weather_city, weather_api_key } = docSnap.data();
    const queryCity = location || weather_city;
    if (!queryCity) return res.status(400).json({ status: "error", message: "Weather location not set" });

    const apiKey = weather_api_key || WEATHERAPI_KEY.value();
    if (!apiKey) return res.status(500).json({ status: "error", message: "Server API Key not configured" });

    const response = await fetch(`https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${encodeURIComponent(queryCity)}&aqi=no`);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`WeatherAPI Error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    res.json({ status: "success", data: { temp: Math.round(data.current.temp_f), condition: data.current.condition.text, description: data.current.condition.text, city: data.location.name } });
  } catch (error) {
    console.error("Weather Error:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
});

// --- ROUTE: STOCK ---
app.post("/stock", async (req, res) => {
  try {
    const { uid, symbol } = req.body;
    if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

    const settingsRef = db.collection("artifacts").doc(APP_ID)
      .collection("users").doc(uid)
      .collection("settings").doc("integrations");

    const docSnap = await settingsRef.get();
    if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

    const { stock_symbol, stock_api_key } = docSnap.data();
    const querySymbol = symbol || stock_symbol;
    if (!querySymbol) return res.status(400).json({ status: "error", message: "Stock symbol not set" });

    const apiKey = stock_api_key || FINNHUB_API_KEY.value();
    if (!apiKey) return res.status(500).json({ status: "error", message: "Server API Key not configured" });

    const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(querySymbol)}&token=${apiKey}`);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Finnhub Error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    res.json({
      status: "success",
      data: {
        symbol: querySymbol.toUpperCase(),
        price: data.c,
        percent: data.dp,
        high: data.h,
        low: data.l
      }
    });
  } catch (error) {
    console.error("Stock Error:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
});

// --- ROUTE: TRAVEL ---
app.post("/travel", async (req, res) => {
  try {
    const { uid, origin, destination, mode } = req.body;
    if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

    const settingsRef = db.collection("artifacts").doc(APP_ID)
      .collection("users").doc(uid)
      .collection("settings").doc("integrations");

    const docSnap = await settingsRef.get();
    if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

    const settings = docSnap.data();
    const queryOrigin = origin || settings.travel_origin;
    const queryDest = destination || settings.travel_destination;
    const queryMode = mode || settings.travel_mode || "driving";

    if (!queryOrigin || !queryDest) {
      return res.status(400).json({ status: "error", message: "Origin or Destination not set" });
    }

    const apiKey = settings.travel_api_key || GOOGLE_MAPS_API_KEY.value();
    if (!apiKey) return res.status(500).json({ status: "error", message: "Google Maps API Key not configured" });

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(queryOrigin)}&destinations=${encodeURIComponent(queryDest)}&mode=${queryMode}&key=${apiKey}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google Maps API Error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    if (data.status !== "OK") throw new Error(`Google Maps API Error: ${data.status} - ${data.error_message || ""}`);

    const element = data.rows[0].elements[0];
    if (element.status !== "OK") return res.status(400).json({ status: "error", message: `Route not found: ${element.status}` });

    res.json({ status: "success", data: { duration: element.duration.text, distance: element.distance.text, origin: data.origin_addresses[0], destination: data.destination_addresses[0], mode: queryMode } });
  } catch (error) {
    console.error("Travel Error:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
});

// --- ROUTE: NEWS ---
app.post("/news", async (req, res) => {
  try {
    const { uid, category } = req.body;
    if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

    const settingsRef = db.collection("artifacts").doc(APP_ID)
      .collection("users").doc(uid)
      .collection("settings").doc("integrations");

    const docSnap = await settingsRef.get();
    if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

    const settings = docSnap.data();
    const queryCategory = category || settings.news_category || "general";
    const apiKey = settings.news_api_key || NEWS_API_KEY.value();

    if (!apiKey) return res.status(500).json({ status: "error", message: "News API Key not configured" });

    const response = await fetch(`https://newsapi.org/v2/top-headlines?country=us&category=${queryCategory}&apiKey=${apiKey}`);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`NewsAPI Error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const articles = data.articles.slice(0, 5).map(a => ({ title: a.title, source: a.source.name }));
    res.json({ status: "success", data: articles });
  } catch (error) {
    console.error("News Error:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
});

exports.api = functions.https.onRequest(app);