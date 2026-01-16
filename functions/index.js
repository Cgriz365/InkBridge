const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));

// CONSTANTS
const APP_ID = "default-app-id"; 

// --- SPOTIFY CONFIGURATION ---
const SPOTIFY_CLIENT_ID = "8872c1c8b9db49fd8c783d24649cce00"; // Replace with your actual Client ID
const SPOTIFY_CLIENT_SECRET = "1bc3e795af464ed19e5e1dd2123b3b0d"; // Replace with your actual Client Secret
const SPOTIFY_REDIRECT_URI = `https://us-central1-${process.env.GCLOUD_PROJECT || "inkbase01"}.cloudfunctions.net/api/spotify/callback`;

// --- 1. STATIC ASSET GENERATOR (SVG ENGINE) ---
const generateStaticSVG = (screen, width, height, colorMode = '1bit') => {
  const isColor = colorMode === 'color';
  
  const colors = {
    bg: "white",
    border: "black",
    weather: isColor ? "#3498db" : "black", 
    stock: isColor ? "#27ae60" : "black",   
    clock: isColor ? "#e67e22" : "black",   
    text: isColor ? "#8e44ad" : "black",    
    calendar: isColor ? "#c0392b" : "black", // Red or BW
    canvas: isColor ? "#e74c3c" : "black",   // Red/Orange or BW
    spotify: isColor ? "#1DB954" : "black",
    default: "black"
  };

  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect width="100%" height="100%" fill="${colors.bg}"/>`;

  screen.widgets.forEach(w => {
    const themeColor = colors[w.type] || colors.default;

    // A. Widget Border
    svg += `<rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" rx="8" ry="8" fill="none" stroke="${colors.border}" stroke-width="2"/>`;
    
    // B. Icons & Labels
    let label = "";
    let iconPath = ""; 

    switch(w.type) {
      case 'weather':
        label = w.config?.city || "WEATHER";
        iconPath = `<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="none" stroke="${themeColor}" stroke-width="2" transform="translate(${w.x + 10}, ${w.y + 10}) scale(1.5)"/>`;
        break;
      case 'stock':
        label = w.config?.symbol || "STOCK";
        iconPath = `<polyline points="3 17 9 11 13 15 21 7" fill="none" stroke="${themeColor}" stroke-width="2" transform="translate(${w.x + 10}, ${w.y + 10}) scale(1.5)"/><polyline points="17 7 21 7 21 11" fill="none" stroke="${themeColor}" stroke-width="2" transform="translate(${w.x + 10}, ${w.y + 10}) scale(1.5)"/>`;
        break;
      case 'clock':
        label = "TIME";
        iconPath = `<circle cx="12" cy="12" r="10" fill="none" stroke="${themeColor}" stroke-width="2" transform="translate(${w.x + 10}, ${w.y + 10}) scale(1.5)"/><polyline points="12 6 12 12 16 14" fill="none" stroke="${themeColor}" stroke-width="2" transform="translate(${w.x + 10}, ${w.y + 10}) scale(1.5)"/>`;
        break;
      case 'text':
        label = "NOTE";
        iconPath = `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" fill="none" stroke="${themeColor}" stroke-width="2" transform="translate(${w.x + 10}, ${w.y + 10}) scale(1.5)"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" fill="none" stroke="${themeColor}" stroke-width="2" transform="translate(${w.x + 10}, ${w.y + 10}) scale(1.5)"/>`;
        break;
      case 'calendar':
        label = "AGENDA";
        // Calendar Icon
        iconPath = `<rect x="3" y="4" width="18" height="18" rx="2" ry="2" fill="none" stroke="${themeColor}" stroke-width="2" transform="translate(${w.x + 10}, ${w.y + 10}) scale(1.2)"/><line x1="16" y1="2" x2="16" y2="6" stroke="${themeColor}" stroke-width="2" transform="translate(${w.x + 10}, ${w.y + 10}) scale(1.2)"/><line x1="8" y1="2" x2="8" y2="6" stroke="${themeColor}" stroke-width="2" transform="translate(${w.x + 10}, ${w.y + 10}) scale(1.2)"/><line x1="3" y1="10" x2="21" y2="10" stroke="${themeColor}" stroke-width="2" transform="translate(${w.x + 10}, ${w.y + 10}) scale(1.2)"/>`;
        break;
      case 'canvas': // Student API
        label = "CANVAS";
        // Book/Assignment Icon
        iconPath = `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" fill="none" stroke="${themeColor}" stroke-width="2" transform="translate(${w.x + 10}, ${w.y + 10}) scale(1.2)"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" fill="none" stroke="${themeColor}" stroke-width="2" transform="translate(${w.x + 10}, ${w.y + 10}) scale(1.2)"/>`;
        break;
      case 'spotify':
        label = "MUSIC";
        iconPath = `<circle cx="12" cy="12" r="10" fill="none" stroke="${themeColor}" stroke-width="2" transform="translate(${w.x + 10}, ${w.y + 10}) scale(1.5)"/><path d="M8 12s2-2 4-2 4 2 4 2" fill="none" stroke="${themeColor}" stroke-width="2" transform="translate(${w.x + 10}, ${w.y + 10}) scale(1.5)"/>`;
        break;
    }

    if(iconPath) svg += iconPath;
    svg += `<text x="${w.x + 45}" y="${w.y + 28}" font-family="sans-serif" font-size="14" fill="${themeColor}" font-weight="bold">${label.toUpperCase()}</text>`;
  });

  svg += `</svg>`;
  return svg;
};

// --- 2. DATA PROVIDERS ---
const getWeather = async (city) => {
  const conditions = ['Sunny', 'Cloudy', 'Rain', 'Snow', 'Clear'];
  return {
    value: `${65 + Math.floor(Math.random() * 20)}°F`, 
    subval: conditions[Math.floor(Math.random() * conditions.length)]
  };
};

const getStock = async (symbol) => {
  const basePrice = 150;
  const current = basePrice + (Math.random() * 10 - 5);
  return { value: `$${current.toFixed(2)}` };
};

const getTime = () => {
  const now = new Date();
  return { value: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
};

const getGoogleCalendar = async (icalUrl) => {
  // Mocking data for now. In production, use 'node-ical' to parse the URL.
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = new Date();
  
  return {
    events: [
      { day: days[(today.getDay() + 0) % 7], time: "10:00 AM", title: "Team Standup" },
      { day: days[(today.getDay() + 1) % 7], time: "2:00 PM", title: "Dentist Appt" },
      { day: days[(today.getDay() + 2) % 7], time: "12:30 PM", title: "Lunch w/ Sarah" },
      { day: days[(today.getDay() + 3) % 7], time: "ALL DAY", title: "Project Due" }
    ]
  };
};

const getCanvasAssignments = async (token) => {
    // Mocking Canvas LMS Response
    // In production: fetch(`https://canvas.instructure.com/api/v1/planner/items...`)
    return {
        assignments: [
            { code: "CS101", name: "Binary Trees", due: "11:59 PM" },
            { code: "HIST200", name: "Essay Draft", due: "4:00 PM" },
            { code: "MATH101", name: "Problem Set 4", due: "Tomorrow" }
        ]
    };
};

const refreshSpotifyToken = async (uid, refreshToken) => {
    console.log(`Refreshing Spotify token for UID: ${uid}`);
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);

    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64'),
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

const getSpotifyPlayback = async (uid, integrationSettings) => {
    let accessToken = integrationSettings.spotify_access_token;
    const refreshToken = integrationSettings.spotify_refresh_token;
    const expiry = integrationSettings.spotify_token_expiry || 0;

    if (!accessToken || !refreshToken) return { is_playing: false, status: "Not Connected" };

    if (Date.now() > expiry - 300000) { // Refresh if expired or expiring in 5 mins
        console.log("Spotify token expired or expiring soon, refreshing...");
        try { accessToken = await refreshSpotifyToken(uid, refreshToken); } 
        catch (e) { console.error("Spotify Refresh Error", e); return { is_playing: false, status: "Token Expired" }; }
    }

    try {
        console.log("Fetching Spotify playback state...");
        const response = await fetch('https://api.spotify.com/v1/me/player?additional_types=episode', { headers: { 'Authorization': `Bearer ${accessToken}` } });
        console.log(`Spotify API response status: ${response.status}`);
        if (response.status === 204) return { is_playing: false, status: "Idle" };
        const data = await response.json();
        if (!data.item) return { is_playing: false, status: "Idle" };
        return { is_playing: data.is_playing, artist: data.item.artists ? data.item.artists.map(a => a.name).join(', ') : data.item.show?.name, track: data.item.name, status: data.is_playing ? "Playing" : "Paused" };
    } catch (e) { 
        console.error("Spotify API Error:", e);
        return { is_playing: false, status: "API Error" }; 
    }
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
        client_id: SPOTIFY_CLIENT_ID,
        scope: scope,
        redirect_uri: SPOTIFY_REDIRECT_URI,
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
        params.append('redirect_uri', SPOTIFY_REDIRECT_URI);
        params.append('grant_type', 'authorization_code');

        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64'),
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

// --- ROUTE: FETCH DISPLAY CONTENT ---
app.get('/display', async (req, res) => {
  try {
    const deviceId = req.headers['x-device-id'] || req.query.device_id;
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    const colorMode = req.headers['x-color-mode'] || "1bit"; 

    if (!deviceId || !apiKey) return res.status(401).json({ status: "error", message: "Unauthorized" });

    const deviceRef = db.collection('artifacts').doc(APP_ID).collection('devices').doc(deviceId);
    const deviceSnap = await deviceRef.get();

    if (!deviceSnap.exists || deviceSnap.data().apiKey !== apiKey) {
      return res.status(403).json({ status: "error", message: "Forbidden" });
    }

    const deviceData = deviceSnap.data();
    const configId = deviceData.activeConfigId;

    if (!configId) return res.json({ status: "success", message: "No config", overlays: [] });

    const configRef = db.collection('artifacts').doc(APP_ID)
                        .collection('users').doc(deviceData.ownerId)
                        .collection('configurations').doc(configId);
    
    const configSnap = await configRef.get();
    if (!configSnap.exists) return res.json({ status: "error", message: "Config missing" });

    const config = configSnap.data();
    const width = config.device_config?.width || 400;
    const height = config.device_config?.height || 300;

    // Fetch Integration Settings (for tokens)
    const settingsSnap = await db.collection('artifacts').doc(APP_ID).collection('users').doc(deviceData.ownerId).collection('settings').doc('integrations').get();
    const integrationSettings = settingsSnap.exists ? settingsSnap.data() : {};

    // --- GENERATE STATIC BACKGROUND ---
    const svgString = generateStaticSVG(config.screens[0], width, height, colorMode);
    const base64Svg = Buffer.from(svgString).toString('base64');
    const bgUrl = `data:image/svg+xml;base64,${base64Svg}`;

    // --- GENERATE DYNAMIC OVERLAYS ---
    const overlays = [];
    if (config.screens && config.screens.length > 0) {
      const activeScreen = config.screens[0];

      for (const w of activeScreen.widgets) {
        let textValue = "";
        let fontSize = 32; 
        let textColor = "black";
        
        const centerX = w.x + (w.w / 2);
        const centerY = w.y + (w.h / 2);

        // -- LIST BASED WIDGETS START HERE --
        if (w.type === 'calendar') {
           const calData = await getGoogleCalendar(w.config?.ical_url);
           // List items
           calData.events.forEach((evt, i) => {
              if (i > 3) return; // Limit items
              overlays.push({
                 type: "text",
                 value: `${evt.day} ${evt.time}`,
                 x: w.x + 10,
                 y: w.y + 50 + (i * 35),
                 size: 14,
                 font: "arial",
                 color: "gray",
                 align: "left"
              });
              overlays.push({
                 type: "text",
                 value: evt.title,
                 x: w.x + 10,
                 y: w.y + 65 + (i * 35),
                 size: 16,
                 font: "arial",
                 color: textColor,
                 align: "left"
              });
           });
           continue; // Skip default processing
        }

        if (w.type === 'canvas') {
           const canvasData = await getCanvasAssignments(w.config?.canvas_token);
           canvasData.assignments.forEach((asn, i) => {
              if (i > 3) return;
              overlays.push({
                 type: "text",
                 value: `${asn.code} - ${asn.due}`,
                 x: w.x + 10,
                 y: w.y + 50 + (i * 35),
                 size: 12,
                 font: "arial",
                 color: "gray",
                 align: "left"
              });
              overlays.push({
                 type: "text",
                 value: asn.name,
                 x: w.x + 10,
                 y: w.y + 65 + (i * 35),
                 size: 14,
                 font: "arial",
                 color: textColor,
                 align: "left"
              });
           });
           continue; 
        }

        if (w.type === 'spotify') {
           const spData = await getSpotifyPlayback(deviceData.ownerId, integrationSettings);
           if (spData.is_playing) {
               overlays.push({ type: "text", value: spData.track.substring(0, 20), x: centerX, y: centerY - 5, size: 16, font: "arial", color: textColor, align: "center" });
               overlays.push({ type: "text", value: spData.artist.substring(0, 25), x: centerX, y: centerY + 15, size: 12, font: "arial", color: "gray", align: "center" });
           } else {
               overlays.push({ type: "text", value: spData.status, x: centerX, y: centerY, size: 16, font: "arial", color: "gray", align: "center" });
           }
           continue;
        }

        // -- SINGLE VALUE WIDGETS --
        if (colorMode === 'color') {
           if (w.type === 'weather') textColor = "#2980b9";
           if (w.type === 'clock') textColor = "#d35400";
           if (w.type === 'text') textColor = "#8e44ad";
        }

        switch (w.type) {
          case 'weather':
            const wData = await getWeather(w.config?.city);
            textValue = wData.value;
            overlays.push({ 
                type: "text", value: wData.subval, x: centerX, y: centerY + 25, size: 16, font: "arial", 
                color: colorMode === 'color' ? "#7f8c8d" : "black", align: "center" 
            });
            break;
          case 'stock':
            const sData = await getStock(w.config?.symbol);
            textValue = sData.value;
            if (colorMode === 'color') textColor = "#27ae60";
            break;
          case 'clock':
            textValue = getTime().value;
            fontSize = 42;
            break;
          case 'text':
            textValue = w.config?.text || "";
            fontSize = 18;
            break;
        }

        if (textValue) {
          overlays.push({
            type: "text",
            value: textValue,
            x: centerX, 
            y: w.type === 'weather' ? centerY - 10 : centerY,
            size: fontSize,
            font: "arial",
            color: textColor,
            align: "center"
          });
        }
      }
    }

    const response = {
      status: "success",
      message: "Data refreshed",
      background_image_url: bgUrl,
      image_filename: `bg_${configId}.svg`,
      refresh_rate: config.device_config?.sleep_seconds || 900,
      firmware_reset: false,
      color_mode: colorMode, 
      overlays: overlays
    };

    res.json(response);

  } catch (error) {
    console.error("Display Error:", error);
    res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
});

exports.api = functions.https.onRequest(app);