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
    const { uid, range } = req.body;
    if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

    const settingsRef = db.collection("artifacts").doc(APP_ID)
      .collection("users").doc(uid)
      .collection("settings").doc("integrations");

    const docSnap = await settingsRef.get();
    if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

    const { ical_url, calendar_range } = docSnap.data();
    if (!ical_url) return res.status(400).json({ status: "error", message: "Calendar not connected" });

    const events = await ical.async.fromURL(ical_url);
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
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

    const settingsRef = db.collection("artifacts").doc(APP_ID)
      .collection("users").doc(uid)
      .collection("settings").doc("integrations");

    const docSnap = await settingsRef.get();
    if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

    let { canvas_token, canvas_domain } = docSnap.data();
    if (!canvas_token || !canvas_domain) return res.status(400).json({ status: "error", message: "Canvas not connected" });

    // Clean domain input
    canvas_domain = canvas_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');

    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // Next 7 days
    const params = new URLSearchParams({ start_date: startDate, end_date: endDate, order: "asc" });

    const response = await fetch(`https://${canvas_domain}/api/v1/planner/items?${params}`, {
      headers: { "Authorization": `Bearer ${canvas_token}` }
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

exports.api = functions.https.onRequest(app);