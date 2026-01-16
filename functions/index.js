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
// These should be set via: firebase functions:config:set spotify.client_id="..." spotify.client_secret="..."
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || functions.config().spotify?.client_id;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || functions.config().spotify?.client_secret;
const SPOTIFY_REDIRECT_URI = `https://us-central1-${process.env.GCLOUD_PROJECT || "inkbase01"}.cloudfunctions.net/api/spotify/callback`;

// --- DATA PROVIDERS ---
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

exports.api = functions.https.onRequest(app);