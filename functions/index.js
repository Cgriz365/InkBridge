const functions = require("firebase-functions");
const { defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const { FieldValue } = require("firebase-admin/firestore");
const ical = require("node-ical");
const { createCanvas } = require("canvas");

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// CONSTANTS
const APP_ID = "default-app-id";

// --- HELPER ---
const getSettingsRef = (uid, deviceId) => {
    const docId = deviceId || "integrations";
    return db.collection("artifacts").doc(APP_ID)
        .collection("users").doc(uid)
        .collection("settings").doc(docId);
};

// --- MIDDLEWARE: DEVICE HEARTBEAT ---
const updateHeartbeat = async (req, res, next) => {
    if (req.query.skip_heartbeat === 'true') return next();

    const deviceId = req.query.device_id || req.headers['x-device-id'];
    if (deviceId) {
        const cleanId = deviceId.trim().toUpperCase().replace(/:/g, '');
        // Fire and forget update to minimize latency
        db.collection('artifacts').doc(APP_ID).collection('devices').doc(cleanId).update({
            lastHandshake: FieldValue.serverTimestamp()
        }).catch(err => console.log("Heartbeat update failed silently", err));
    }
    next();
};

app.use(updateHeartbeat);

// --- SPOTIFY CONFIGURATION ---
const SPOTIFY_CLIENT_ID = defineString("SPOTIFY_CLIENT_ID");
const SPOTIFY_CLIENT_SECRET = defineString("SPOTIFY_CLIENT_SECRET");
const WEATHERAPI_KEY = defineString("WEATHERAPI_KEY");
const FINNHUB_API_KEY = defineString("FINNHUB_API_KEY");
const GOOGLE_MAPS_API_KEY = defineString("GOOGLE_MAPS_API_KEY");
const NEWS_API_KEY = defineString("NEWS_API_KEY");
const COINMARKETCAP_API_KEY = defineString("COINMARKETCAP_API_KEY");

const getSpotifyRedirectUri = () => {
    return `https://us-central1-${process.env.GCLOUD_PROJECT || "inkbase01"}.cloudfunctions.net/api/spotify/callback`;
};

// --- DATA PROVIDERS ---
const refreshSpotifyToken = async (uid, refreshToken, deviceId) => {
    console.log(`Refreshing Spotify token for UID: ${uid} Device: ${deviceId}`);
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

    await getSettingsRef(uid, deviceId).set(updates, { merge: true });
    console.log(`Spotify token refreshed successfully for UID: ${uid}`);

    return data.access_token;
};

const makeSpotifyRequest = async (uid, endpoint, method = "GET", body = null, deviceId = null) => {
    const settingsRef = getSettingsRef(uid, deviceId);

    const docSnap = await settingsRef.get();
    if (!docSnap.exists) throw new Error("User settings not found");

    let { spotify_access_token, spotify_refresh_token, spotify_token_expiry } = docSnap.data();

    if (!spotify_access_token || !spotify_refresh_token) {
        throw new Error("Spotify not connected");
    }

    // Check if token is expired or expiring in the next 5 minutes
    if (Date.now() > (spotify_token_expiry - 300000)) {
        console.log(`Token expired for ${uid}, refreshing...`);
        spotify_access_token = await refreshSpotifyToken(uid, spotify_refresh_token, deviceId);
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
        let deviceId = req.headers['x-device-id'] || req.query.device_id;
        if (!deviceId) return res.status(400).json({ status: "error", message: "Missing Device ID" });

        deviceId = deviceId.trim().toUpperCase().replace(/:/g, '');

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
            uid: deviceData.uid || null,
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
    const deviceId = req.query.device_id;
    console.log(`Initiating Spotify login for UID: ${uid}`);
    const redirectUrl = req.query.redirect || "http://localhost:5173";
    if (!uid) return res.status(400).send("Missing UID");

    // ADDED: user-modify-playback-state
    const scope = 'user-read-playback-state user-read-currently-playing user-modify-playback-state';
    const state = JSON.stringify({ uid, redirectUrl, deviceId });

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

    const { uid, redirectUrl, deviceId } = JSON.parse(state);
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

        await getSettingsRef(uid, deviceId).set({ spotify_access_token: data.access_token, spotify_refresh_token: data.refresh_token, spotify_token_expiry: Date.now() + (data.expires_in * 1000), spotify_enabled: true }, { merge: true });

        console.log("Spotify token exchange successful, redirecting...");
        res.redirect(redirectUrl);
    } catch (error) { console.error("Spotify Auth Error:", error); res.status(500).send("Authentication Error"); }
});

app.post("/spotify/request", async (req, res) => {
    try {
        const { uid, endpoint, method, body, device_id } = req.body;
        if (!uid || !endpoint) {
            return res.status(400).json({ status: "error", message: "Missing uid or endpoint" });
        }
        const data = await makeSpotifyRequest(uid, endpoint, method, body, device_id);
        res.json({ status: "success", data });
    } catch (error) {
        console.error("Spotify Proxy Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

// --- ROUTE: SPOTIFY EXTENDED ---
app.post("/spotify/user_albums", async (req, res) => {
    try {
        const { uid, limit, offset, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const queryLimit = limit || 5;
        const queryOffset = offset || 0;

        const data = await makeSpotifyRequest(uid, `me/albums?limit=${queryLimit}&offset=${queryOffset}`, "GET", null, device_id);

        const albums = data.items.map(item => ({
            name: item.album.name,
            artist: item.album.artists.map(a => a.name).join(", "),
            image: item.album.images[0]?.url || null,
            uri: item.album.uri
        }));

        res.json({ status: "success", data: albums });
    } catch (error) {
        console.error("Spotify Albums Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

app.post("/spotify/user_playlists", async (req, res) => {
    try {
        const { uid, limit, offset, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const queryLimit = limit || 5;
        const queryOffset = offset || 0;

        const data = await makeSpotifyRequest(uid, `me/playlists?limit=${queryLimit}&offset=${queryOffset}`, "GET", null, device_id);

        const playlists = data.items.map(item => ({
            name: item.name,
            owner: item.owner.display_name,
            image: item.images[0]?.url || null,
            uri: item.uri,
            total_tracks: item.tracks.total
        }));

        res.json({ status: "success", data: playlists });
    } catch (error) {
        console.error("Spotify Playlists Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

app.post("/spotify/liked_songs", async (req, res) => {
    try {
        const { uid, limit, offset, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const queryLimit = limit || 5;
        const queryOffset = offset || 0;

        const data = await makeSpotifyRequest(uid, `me/tracks?limit=${queryLimit}&offset=${queryOffset}`, "GET", null, device_id);

        const tracks = data.items.map(item => ({
            name: item.track.name,
            artist: item.track.artists.map(a => a.name).join(", "),
            album: item.track.album.name,
            image: item.track.album.images[0]?.url || null,
            uri: item.track.uri,
            duration_ms: item.track.duration_ms
        }));

        res.json({ status: "success", data: tracks });
    } catch (error) {
        console.error("Spotify Liked Songs Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

app.post("/spotify/followed_artists", async (req, res) => {
    try {
        const { uid, limit, after, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const queryLimit = limit || 5;
        const queryAfter = after ? `&after=${after}` : "";

        const data = await makeSpotifyRequest(uid, `me/following?type=artist&limit=${queryLimit}${queryAfter}`, "GET", null, device_id);

        const artists = data.artists.items.map(item => ({
            name: item.name,
            image: item.images[0]?.url || null,
            uri: item.uri,
            genres: item.genres.slice(0, 2).join(", ")
        }));

        res.json({ status: "success", data: artists });
    } catch (error) {
        console.error("Spotify Artists Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

app.post("/spotify/playback", async (req, res) => {
    try {
        const { uid, action, uri, device_id, volume_percent, position_ms, state, target_device_id } = req.body;
        if (!uid || !action) return res.status(400).json({ status: "error", message: "Missing UID or action" });

        let endpoint = "";
        let method = "PUT";
        let body = null;

        switch (action) {
            case "play":
                endpoint = "me/player/play";
                if (uri) {
                    if (uri.includes("track")) body = { uris: [uri] };
                    else body = { context_uri: uri };
                }
                break;
            case "pause":
                endpoint = "me/player/pause";
                break;
            case "next":
                endpoint = "me/player/next";
                method = "POST";
                break;
            case "previous":
                endpoint = "me/player/previous";
                method = "POST";
                break;
            case "seek":
                endpoint = `me/player/seek?position_ms=${position_ms || 0}`;
                break;
            case "volume":
                endpoint = `me/player/volume?volume_percent=${volume_percent || 50}`;
                break;
            case "shuffle":
                endpoint = `me/player/shuffle?state=${state === 'true' || state === true}`;
                break;
            case "repeat":
                endpoint = `me/player/repeat?state=${state || 'off'}`;
                break;
            case "transfer":
                endpoint = "me/player";
                if (!target_device_id) return res.status(400).json({ status: "error", message: "Missing target_device_id" });
                body = { device_ids: [target_device_id], play: true };
                break;
            default:
                return res.status(400).json({ status: "error", message: "Invalid action" });
        }

        await makeSpotifyRequest(uid, endpoint, method, body, device_id);
        res.json({ status: "success", message: `Action ${action} executed` });
    } catch (error) {
        console.error("Spotify Playback Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

app.post("/spotify/devices", async (req, res) => {
    try {
        const { uid, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const data = await makeSpotifyRequest(uid, "me/player/devices", "GET", null, device_id);

        const devices = data.devices.map(d => ({
            id: d.id,
            name: d.name,
            type: d.type,
            is_active: d.is_active,
            volume: d.volume_percent
        }));

        res.json({ status: "success", data: devices });
    } catch (error) {
        console.error("Spotify Devices Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

// --- ROUTE: CALENDAR ---
app.post("/calendar", async (req, res) => {
    try {
        const { uid, range, url, device_id, simple } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const settingsRef = getSettingsRef(uid, device_id);

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

        const vcal = events['vcalendar'];
        const calendarDetails = {
            name: vcal?.['WR-CALNAME'] || vcal?.['X-WR-CALNAME'] || null,
            timezone: vcal?.['WR-TIMEZONE'] || vcal?.['X-WR-TIMEZONE'] || null,
            description: vcal?.['WR-CALDESC'] || vcal?.['X-WR-CALDESC'] || null
        };

        const results = [];
        for (const event of Object.values(events)) {
            if (event.type !== "VEVENT" || !event.start) continue;

            const startDate = new Date(event.start);
            const endDate = event.end ? new Date(event.end) : new Date(startDate.getTime() + 3600000);
            const duration = endDate.getTime() - startDate.getTime();

            const buildEvent = (evt, start, end) => {
                if (simple) {
                    return {
                        name: evt.summary,
                        start: start.toISOString(),
                        end: end.toISOString(),
                        location: evt.location || null
                    };
                }
                const isFullDay = evt.datetype === 'date';
                let alarm = null;
                if (evt.alarms) {
                    const alarmKeys = Object.keys(evt.alarms);
                    if (alarmKeys.length > 0) alarm = evt.alarms[alarmKeys[0]].trigger;
                }
                let organizer = null;
                if (evt.organizer) {
                    if (typeof evt.organizer === 'string') organizer = evt.organizer;
                    else if (evt.organizer.params && evt.organizer.params.CN) organizer = evt.organizer.params.CN;
                    else if (evt.organizer.val) organizer = evt.organizer.val;
                }
                return {
                    name: evt.summary,
                    start: start.toISOString(),
                    end: end.toISOString(),
                    duration: duration,
                    location: evt.location || null,
                    description: evt.description || null,
                    transparency: isFullDay ? "Full Day" : "Timed Event",
                    structured_location: evt['X-APPLE-STRUCTURED-LOCATION'] || null,
                    alarm: alarm,
                    organizer: organizer
                };
            };

            if (event.rrule) {
                const searchStart = new Date(now.getTime() - duration);
                try {
                    const dates = event.rrule.between(searchStart, endLimit, true);
                    dates.forEach((date) => {
                        const instanceStart = new Date(date);
                        const instanceEnd = new Date(instanceStart.getTime() + duration);
                        if (instanceEnd >= now && instanceStart <= endLimit) {
                            results.push(buildEvent(event, instanceStart, instanceEnd));
                        }
                    });
                } catch (e) { console.error(`RRule Error for ${event.summary}:`, e); }
            } else if (endDate >= now && startDate <= endLimit) {
                results.push(buildEvent(event, startDate, endDate));
            }
        }

        const upcoming = results.sort((a, b) => new Date(a.start) - new Date(b.start));

        res.json({ status: "success", data: { calendar: calendarDetails, events: upcoming } });
    } catch (error) {
        console.error("Calendar Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

// --- ROUTE: CANVAS ---
app.post("/canvas", async (req, res) => {
    try {
        const { uid, type, domain, token, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const settingsRef = getSettingsRef(uid, device_id);

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

// --- ROUTE: CANVAS COURSES ---
app.post("/canvas/courses", async (req, res) => {
    try {
        const { uid, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const settingsRef = getSettingsRef(uid, device_id);
        const docSnap = await settingsRef.get();
        if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

        let { canvas_token, canvas_domain } = docSnap.data();
        if (!canvas_token || !canvas_domain) return res.status(400).json({ status: "error", message: "Canvas not connected" });

        canvas_domain = canvas_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');

        const response = await fetch(`https://${canvas_domain}/api/v1/courses?enrollment_state=active&include[]=total_scores&include[]=term&include[]=course_progress&include[]=public_description`, {
            headers: { "Authorization": `Bearer ${canvas_token}` }
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Canvas API Error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const courses = data.map(course => ({
            name: course.name,
            id: course.id,
            state: course.workflow_state,
            progress: course.enrollments?.[0]?.computed_current_score || 0,
            calendar_link: course.calendar?.ics || `https://${canvas_domain}/feeds/calendars/course_${course.id}.ics`
        }));

        res.json({ status: "success", data: courses });
    } catch (error) {
        console.error("Canvas Courses Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

// --- ROUTE: CANVAS COURSE DETAILS ---
app.post("/canvas/course", async (req, res) => {
    try {
        const { uid, course_id, course_name, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });
        if (!course_id && !course_name) return res.status(400).json({ status: "error", message: "Missing Course ID or Name" });

        const settingsRef = getSettingsRef(uid, device_id);
        const docSnap = await settingsRef.get();
        if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

        let { canvas_token, canvas_domain } = docSnap.data();
        if (!canvas_token || !canvas_domain) return res.status(400).json({ status: "error", message: "Canvas not connected" });

        canvas_domain = canvas_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');

        let targetId = course_id;

        if (!targetId && course_name) {
            const coursesRes = await fetch(`https://${canvas_domain}/api/v1/courses?enrollment_state=active`, {
                headers: { "Authorization": `Bearer ${canvas_token}` }
            });
            const courses = await coursesRes.json();
            const match = courses.find(c => c.name.toLowerCase().includes(course_name.toLowerCase()));
            if (!match) return res.status(404).json({ status: "error", message: "Course not found" });
            targetId = match.id;
        }

        const assignmentsRes = await fetch(`https://${canvas_domain}/api/v1/courses/${targetId}/assignments?bucket=upcoming&order_by=due_at`, {
            headers: { "Authorization": `Bearer ${canvas_token}` }
        });
        const assignmentsData = await assignmentsRes.json();

        const todos = assignmentsData.map(a => ({
            name: a.name,
            id: a.id,
            due_date: a.due_at,
            description: a.description,
            type: a.submission_types
        }));

        const submissionsRes = await fetch(`https://${canvas_domain}/api/v1/courses/${targetId}/students/submissions?include[]=assignment&include[]=submission_comments&order=graded_at&descending`, {
            headers: { "Authorization": `Bearer ${canvas_token}` }
        });
        const submissionsData = await submissionsRes.json();

        const feedback = submissionsData
            .filter(s => s.graded_at)
            .slice(0, 5)
            .map(s => ({
                assignment_name: s.assignment?.name,
                score: s.score,
                grade: s.grade,
                graded_at: s.graded_at,
                feedback: s.submission_comments?.map(c => c.comment).join("\n") || ""
            }));

        res.json({ status: "success", data: { todos, feedback } });
    } catch (error) {
        console.error("Canvas Course Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

// --- ROUTE: CANVAS ASSIGNMENT ---
app.post("/canvas/assignment", async (req, res) => {
    try {
        const { uid, course_id, assignment_id, assignment_name, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });
        if (!course_id) return res.status(400).json({ status: "error", message: "Missing Course ID" });
        if (!assignment_id && !assignment_name) return res.status(400).json({ status: "error", message: "Missing Assignment ID or Name" });

        const settingsRef = getSettingsRef(uid, device_id);
        const docSnap = await settingsRef.get();
        if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

        let { canvas_token, canvas_domain } = docSnap.data();
        if (!canvas_token || !canvas_domain) return res.status(400).json({ status: "error", message: "Canvas not connected" });

        canvas_domain = canvas_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');

        let targetId = assignment_id;

        if (!targetId && assignment_name) {
            const searchRes = await fetch(`https://${canvas_domain}/api/v1/courses/${course_id}/assignments?search_term=${encodeURIComponent(assignment_name)}`, {
                headers: { "Authorization": `Bearer ${canvas_token}` }
            });
            const searchData = await searchRes.json();
            if (!searchData.length) return res.status(404).json({ status: "error", message: "Assignment not found" });
            targetId = searchData[0].id;
        }

        const assignmentRes = await fetch(`https://${canvas_domain}/api/v1/courses/${course_id}/assignments/${targetId}`, {
            headers: { "Authorization": `Bearer ${canvas_token}` }
        });
        if (!assignmentRes.ok) throw new Error("Failed to fetch assignment");
        const assignment = await assignmentRes.json();

        const submissionRes = await fetch(`https://${canvas_domain}/api/v1/courses/${course_id}/assignments/${targetId}/submissions/self`, {
            headers: { "Authorization": `Bearer ${canvas_token}` }
        });
        const submission = submissionRes.ok ? await submissionRes.json() : {};

        const courseRes = await fetch(`https://${canvas_domain}/api/v1/courses/${course_id}`, {
            headers: { "Authorization": `Bearer ${canvas_token}` }
        });
        const course = courseRes.ok ? await courseRes.json() : { name: "Unknown Course" };

        res.json({
            status: "success",
            data: {
                course_name: course.name,
                course_id: course.id,
                assignment_name: assignment.name,
                id: assignment.id,
                marked_complete: false,
                dismissed: false,
                submission_status: submission.workflow_state || "unsubmitted",
                grade: submission.grade,
                html_url: assignment.html_url
            }
        });
    } catch (error) {
        console.error("Canvas Assignment Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

// --- ROUTE: WEATHER ---
app.post("/weather", async (req, res) => {
    try {
        const { uid, location, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const settingsRef = getSettingsRef(uid, device_id);

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

// --- ROUTE: WEATHER FORECAST ---
app.post("/weather/forecast", async (req, res) => {
    try {
        const { uid, location, days, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const settingsRef = getSettingsRef(uid, device_id);
        const docSnap = await settingsRef.get();
        if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

        const { forecast_city, weather_api_key } = docSnap.data();
        const queryCity = location || forecast_city;
        if (!queryCity) return res.status(400).json({ status: "error", message: "Location not set" });

        const apiKey = weather_api_key || WEATHERAPI_KEY.value();
        if (!apiKey) return res.status(500).json({ status: "error", message: "Server API Key not configured" });

        const queryDays = days || 3;
        const response = await fetch(`https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(queryCity)}&days=${queryDays}&aqi=no&alerts=no`);
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`WeatherAPI Error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const forecast = data.forecast.forecastday.map(d => ({
            date: d.date,
            max_temp: d.day.maxtemp_f,
            min_temp: d.day.mintemp_f,
            condition: d.day.condition.text
        }));
        res.json({ status: "success", data: { city: data.location.name, forecast } });
    } catch (error) {
        console.error("Weather Forecast Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

// --- ROUTE: WEATHER HISTORY ---
app.post("/weather/history", async (req, res) => {
    try {
        const { uid, location, date, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const settingsRef = getSettingsRef(uid, device_id);
        const docSnap = await settingsRef.get();
        if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

        const { history_city, history_date, weather_api_key } = docSnap.data();
        const queryCity = location || history_city;

        // Default to today if no date provided
        const targetDateStr = date || history_date || new Date().toISOString().split('T')[0];

        // Calculate range (7 days ending on target date)
        const endDate = new Date(targetDateStr);
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 6);

        const dtStr = startDate.toISOString().split('T')[0];
        const endDtStr = endDate.toISOString().split('T')[0];

        if (!queryCity) return res.status(400).json({ status: "error", message: "Location not set" });

        const apiKey = weather_api_key || WEATHERAPI_KEY.value();
        if (!apiKey) return res.status(500).json({ status: "error", message: "Server API Key not configured" });

        const response = await fetch(`https://api.weatherapi.com/v1/history.json?key=${apiKey}&q=${encodeURIComponent(queryCity)}&dt=${dtStr}&end_dt=${endDtStr}`);
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`WeatherAPI Error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const history = data.forecast.forecastday.map(d => ({
            date: d.date,
            avg_temp: d.day.avgtemp_f,
            condition: d.day.condition.text
        }));
        res.json({ status: "success", data: { city: data.location.name, history } });
    } catch (error) {
        console.error("Weather History Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

// --- ROUTE: ASTRONOMY ---
app.post("/astronomy", async (req, res) => {
    try {
        const { uid, location, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const settingsRef = getSettingsRef(uid, device_id);

        const docSnap = await settingsRef.get();
        if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

        const { astronomy_city, astronomy_api_key } = docSnap.data();
        const queryCity = location || astronomy_city;
        if (!queryCity) return res.status(400).json({ status: "error", message: "Astronomy location not set" });

        const apiKey = astronomy_api_key || WEATHERAPI_KEY.value();
        if (!apiKey) return res.status(500).json({ status: "error", message: "Server API Key not configured" });

        const response = await fetch(`https://api.weatherapi.com/v1/astronomy.json?key=${apiKey}&q=${encodeURIComponent(queryCity)}`);
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`WeatherAPI Error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const astro = data.astronomy.astro;
        res.json({
            status: "success",
            data: {
                location: data.location.name,
                sunrise: astro.sunrise,
                sunset: astro.sunset,
                moonrise: astro.moonrise,
                moonset: astro.moonset,
                moon_phase: astro.moon_phase,
                moon_illumination: astro.moon_illumination,
                is_sun_up: astro.is_sun_up
            }
        });
    } catch (error) {
        console.error("Astronomy Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

// --- ROUTE: STOCK ---
app.post("/stock", async (req, res) => {
    try {
        const { uid, symbol, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const settingsRef = getSettingsRef(uid, device_id);

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
                low: data.l,
                open: data.o,
                previous_close: data.pc
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
        const { uid, origin, destination, mode, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const settingsRef = getSettingsRef(uid, device_id);

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
        const { uid, category, search, limit, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const settingsRef = getSettingsRef(uid, device_id);

        const docSnap = await settingsRef.get();
        if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

        const settings = docSnap.data();
        const queryCategory = category || settings.news_category || "general";
        const querySearch = search ? `&q=${encodeURIComponent(search)}` : "";
        const queryLimit = limit || 5;
        const apiKey = settings.news_api_key || NEWS_API_KEY.value();

        if (!apiKey) return res.status(500).json({ status: "error", message: "News API Key not configured" });

        const response = await fetch(`https://newsapi.org/v2/top-headlines?country=us&category=${queryCategory}${querySearch}&pageSize=${queryLimit}&apiKey=${apiKey}`);
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`NewsAPI Error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const articles = data.articles.map(a => ({
            title: a.title,
            source: a.source.name,
            description: a.description,
            published_at: a.publishedAt
        }));
        res.json({ status: "success", data: articles });
    } catch (error) {
        console.error("News Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

// --- ROUTE: CRYPTO ---
app.post("/crypto", async (req, res) => {
    try {
        const { uid, symbol, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const settingsRef = getSettingsRef(uid, device_id);
        const docSnap = await settingsRef.get();
        if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

        const { crypto_symbol, crypto_api_key } = docSnap.data();
        const querySymbol = symbol || crypto_symbol;
        if (!querySymbol) return res.status(400).json({ status: "error", message: "Crypto symbol not set" });

        const apiKey = crypto_api_key || COINMARKETCAP_API_KEY.value();
        if (!apiKey) return res.status(500).json({ status: "error", message: "Server API Key not configured" });

        const response = await fetch(`https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${querySymbol.toUpperCase()}`, {
            headers: { 'X-CMC_PRO_API_KEY': apiKey }
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`CoinMarketCap Error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const coinData = data.data[querySymbol.toUpperCase()];

        if (!coinData) throw new Error("Symbol not found");

        const quote = coinData.quote.USD;
        res.json({
            status: "success",
            data: {
                symbol: coinData.symbol,
                name: coinData.name,
                price: quote.price,
                percent_change_24h: quote.percent_change_24h,
                market_cap: quote.market_cap,
                volume_24h: quote.volume_24h
            }
        });
    } catch (error) {
        console.error("Crypto Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

// --- ROUTE: STOCK ARRAY ---
app.post("/stock/array", async (req, res) => {
    try {
        const { uid, symbol, days, interval, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const settingsRef = getSettingsRef(uid, device_id);
        const docSnap = await settingsRef.get();
        if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

        const { stock_symbol, stock_api_key } = docSnap.data();
        const querySymbol = symbol || stock_symbol;
        if (!querySymbol) return res.status(400).json({ status: "error", message: "Stock symbol not set" });

        const apiKey = stock_api_key || FINNHUB_API_KEY.value();
        if (!apiKey) return res.status(500).json({ status: "error", message: "Server API Key not configured" });

        const numDays = days || 7;
        const resolution = interval || "D";
        const to = Math.floor(Date.now() / 1000);
        const from = to - (numDays * 24 * 60 * 60);

        const response = await fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(querySymbol)}&resolution=${resolution}&from=${from}&to=${to}&token=${apiKey}`);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Finnhub Error ${response.status}: ${errText}`);
        }

        const data = await response.json();

        if (data.s === "no_data") {
            return res.json({ status: "success", data: [] });
        }

        const chartData = data.t.map((timestamp, index) => ({
            date: new Date(timestamp * 1000).toISOString().split('T')[0],
            price: data.c[index]
        }));

        res.json({ status: "success", data: chartData });
    } catch (error) {
        console.error("Stock Array Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

// --- ROUTE: CRYPTO ARRAY ---
app.post("/crypto/array", async (req, res) => {
    try {
        const { uid, symbol, days, interval, device_id } = req.body;
        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const settingsRef = getSettingsRef(uid, device_id);
        const docSnap = await settingsRef.get();
        if (!docSnap.exists) return res.status(404).json({ status: "error", message: "User settings not found" });

        const { crypto_symbol } = docSnap.data();
        const querySymbol = symbol || crypto_symbol;
        if (!querySymbol) return res.status(400).json({ status: "error", message: "Crypto symbol not set" });

        // Using CryptoCompare for historical data as it supports symbols directly and has a free tier
        const numDays = days || 7;
        let endpoint = "histoday";
        let limit = numDays;

        if (interval === "hourly") {
            endpoint = "histohour";
            limit = numDays * 24; // Convert days to hours for the limit
        }

        const response = await fetch(`https://min-api.cryptocompare.com/data/v2/${endpoint}?fsym=${querySymbol.toUpperCase()}&tsym=USD&limit=${limit}`);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`CryptoCompare Error ${response.status}: ${errText}`);
        }

        const data = await response.json();

        if (data.Response === "Error") {
            throw new Error(data.Message);
        }

        const chartData = data.Data.Data.map(item => ({
            date: new Date(item.time * 1000).toISOString().split('T')[0],
            price: item.close
        }));

        res.json({ status: "success", data: chartData });
    } catch (error) {
        console.error("Crypto Array Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

// --- ROUTE: LAYOUT BACKGROUND ---
app.get("/layout/background", async (req, res) => {
    try {
        const uid = req.query.uid;
        const deviceId = req.query.device_id;

        if (!uid) return res.status(400).send("Missing UID");

        const settingsRef = getSettingsRef(uid, deviceId);
        const docSnap = await settingsRef.get();

        // Defaults
        let layoutType = "quadrant";
        let slots = {};

        if (docSnap.exists) {
            const data = docSnap.data();
            if (data.layout_type) layoutType = data.layout_type;
            if (data.layout_slots) {
                const parsed = JSON.parse(data.layout_slots);
                // Support nested format (by layout type) or fallback to flat format
                if (parsed[layoutType]) {
                    slots = parsed[layoutType];
                } else if (Object.values(parsed).every(v => typeof v === 'string')) {
                    // Backward compatibility for flat structure
                    slots = parsed;
                }
            }
        }

        // E-Ink Resolution (Standard 7.5")
        const width = 800;
        const height = 480;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");

        // Clear Background
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);

        // Draw Settings
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 4;
        ctx.fillStyle = "#000000";
        ctx.font = "bold 24px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        const drawSlot = (x, y, w, h, id) => {
            ctx.strokeRect(x, y, w, h);
            // Draw Service Header if assigned
            const serviceId = slots[id];
            if (serviceId) {
                // Header Bar
                ctx.fillStyle = "#000000";
                ctx.fillRect(x, y, w, 40);

                // Text
                ctx.fillStyle = "#FFFFFF";
                ctx.fillText(serviceId.toUpperCase(), x + 10, y + 8);
            }
        };

        if (layoutType === "quadrant") {
            const hw = width / 2;
            const hh = height / 2;
            drawSlot(0, 0, hw, hh, "0");
            drawSlot(hw, 0, hw, hh, "1");
            drawSlot(0, hh, hw, hh, "2");
            drawSlot(hw, hh, hw, hh, "3");
        } else if (layoutType === "thirds") {
            const cw = width / 3;
            drawSlot(0, 0, cw, height, "0");
            drawSlot(cw, 0, cw, height, "1");
            drawSlot(cw * 2, 0, cw, height, "2");
        } else if (layoutType === "focus") {
            const hh = height / 2;
            drawSlot(0, 0, width, hh, "0");
            drawSlot(0, hh, width / 2, hh, "1");
            drawSlot(width / 2, hh, width / 2, hh, "2");
        } else {
            // Single
            drawSlot(0, 0, width, height, "0");
        }

        res.set("Content-Type", "image/jpeg");
        res.send(canvas.toBuffer("image/jpeg"));
    } catch (error) {
        console.error("Layout Background Error:", error);
        res.status(500).send("Error generating layout");
    }
});

// --- ROUTE: LAYOUT DATA ---
app.get("/layout/data", async (req, res) => {
    try {
        const uid = req.query.uid;
        const deviceId = req.query.device_id;

        if (!uid) return res.status(400).json({ status: "error", message: "Missing UID" });

        const settingsRef = getSettingsRef(uid, deviceId);
        const docSnap = await settingsRef.get();
        if (!docSnap.exists) return res.status(404).json({ status: "error", message: "Settings not found" });

        const settings = docSnap.data();
        const layoutType = settings.layout_type || "quadrant";
        let slots = {};

        if (settings.layout_slots) {
            const parsed = JSON.parse(settings.layout_slots);
            if (parsed[layoutType]) {
                slots = parsed[layoutType];
            } else if (Object.values(parsed).every(v => typeof v === 'string')) {
                slots = parsed;
            }
        }

        const result = {};

        // Helper to fetch data internally (simplified for key widgets)
        const fetchDataForSlot = async (serviceId) => {
            try {
                if (serviceId === "weather") {
                    // Reuse logic or call external API if needed.
                    // For this example, we return a placeholder structure that the ESP32 would expect
                    // In a production app, refactor the route logic into helper functions to call here.
                    return { type: "weather", location: settings.weather_city };
                }
                if (serviceId === "stock") return { type: "stock", symbol: settings.stock_symbol };
                if (serviceId === "crypto") return { type: "crypto", symbol: settings.crypto_symbol };
                if (serviceId === "calendar") return { type: "calendar", url: settings.ical_url };
                return { type: serviceId, status: "enabled" };
            } catch (e) { return { error: e.message }; }
        };

        for (const [slotId, serviceId] of Object.entries(slots)) {
            if (serviceId) {
                result[slotId] = await fetchDataForSlot(serviceId);
            }
        }

        res.json({ status: "success", data: result });
    } catch (error) {
        console.error("Layout Data Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

exports.api = functions.https.onRequest(app);
