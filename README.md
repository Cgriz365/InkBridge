# [InkBridge](https://inkbase01.web.app)
<p align="center">
  <img src="Resources/InkBridgeDashboard.png" width="865">
  <img src="Resources/InkBridgeIntegrations.png" height="250">
  <img src="Resources/InkBridgeSetup.png" height="250"
</p>
  
___

# InkBridge Technical Overview

InkBridge is a full-stack IoT solution designed to drive ESP32-based displays. It utilizes a centralized controller pattern where the "heavy lifting" (API authentication, and data aggregation) is offloaded to the cloud to minimize the processing requirements of the low-power client. While designed for low-power clients (E-Ink displays), Inkbase functions to drive any internet enabled device given an API and the capability to make web requests.

## System Architecture

- **Frontend (React)**: A web-based control panel for device linking, service configuration, and status monitoring.
- **Backend (Node.js/Firebase)**: A serverless API that aggregates data from 3rd party APIs, and handles Spotify OAuth authentication.
- **Device (ESP32)(Raspberry Pi)**: An embedded client that polls the backend for display instructions (background images and text overlays).

## Backend Analysis

The backend is built using Firebase Functions and Express. It serves as the bridge between the physical device and web services. The primary logic resides in `index.js`.

### Core Modules
**Data Providers:**
- **Mock Data**: Weather, Stock (placeholders for production APIs). *Under Development*
- **Live Data**: Time, Spotify, Calendar, Canvas LMS.

**Spotify Integration**: Implements the OAuth 2.0 Authorization Code Flow. It automatically handles token refreshing if the access token is expired before fetching playback state.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/setup` | GET | Handles the initial handshake. Receives a physical `device_id` and returns an API Key associated with the user account. |
| `/spotify/login` | GET | Initiates the OAuth login flow, redirecting the user to Spotify. |
| `/spotify/callback` | GET | Handles the OAuth callback, exchanges the code for tokens, and saves them to Firestore. |
| `/spotify/request` | POST | Proxies authenticated requests to the Spotify Web API (e.g., current playback). |
| `/calendar` | POST | Fetches and parses the user's iCal feed, returning a filtered list of upcoming events. |
| `/canvas` | POST | Proxies requests to the Canvas LMS API to retrieve upcoming assignments. |

## Frontend Analysis

The frontend is a React application (`App.tsx`) initialized with Firebase. It uses `lucide-react` for iconography and manages state for a smooth single-page application (SPA) experience.

### Key Components

**InkBridge (Main)**: Manages the application lifecycle, including Authentication (Google Sign-In) and View Routing.

**Dashboard View**: Visualizes the "live" data pipeline, mocking the data sent to the device to provide immediate user feedback.

**Setup View**: Provides the interface to link a physical device. It generates API Secrets (`sk_...`) and provides a firmware logic snippet for the user.

**Integrations View**: A configuration hub where users enable services and input credentials (API keys, cities, iCal URLs).

### Data Management

Data is stored in Firestore with the following structure:

| Collection Path | Purpose |
|----------------|---------|
| `artifacts/{APP_ID}/users/{uid}/settings/integrations` | Stores user configuration (weather cities, API keys, OAuth tokens). |
| `artifacts/{APP_ID}/devices/{deviceId}` | Maps physical hardware MAC addresses to user accounts. |
| `artifacts/{APP_ID}/users/{uid}/configurations` | Stores display layout settings (widgets, positions). |

## Key Mechanisms

### Spotify OAuth Flow

The application implements a full server-side OAuth flow:

1. **Trigger**: User clicks "Connect Spotify" in the Frontend.
2. **Redirect**: Backend constructs the authorization URL with state (User UID) and redirects to Spotify.
3. **Callback**: Spotify calls the backend with a code.
4. **Storage**: Backend exchanges code for Access/Refresh tokens and stores them securely in Firestore.

## TO-DO
### Backend Development (Node JS)
- [ ] **Weather Module (getWeather)**
- Register for OpenWeatherMap API.
- Replace random math with axios or fetch call to OpenWeatherMap One Call API.
- Map API response icons to internal SVG paths.
- [ ] **Stock Module (getStock)**
- Register for Finnhub.io or AlphaVantage.
- Replace random math with real API calls for the requested symbol.
- [x] **Calendar Module (getGoogleCalendar)**
- Install node-ical package.
- Implement logic to fetch the user's ical_url, parse the VCALENDAR stream, and filter for upcoming events.
- [x] **Canvas LMS Module (getCanvasAssignments)**
- Implement a fetch call to the user's Canvas domain /api/v1/planner/items.
- Pass the user's canvas_token in the Authorization header.
### Frontend Development (Typescript)
- [x] **Device Linking UX**
- Add a visual indicator in the "Setup" tab that listens to the devices collection. When a device is successfully linked, auto-refresh the UI to confirm the connection immediately.
- [x] **API Functionality Checks**
- Add a button indicator in the "Integrations" tab the allows the user to test their API keys. The integrations tab will show a refeshed list of information fetched from the API.
- [x] **Auto-Saving**
- Add auto-saving functionality to the integrations page.
