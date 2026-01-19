# InkBridge System Logic Flow

## 1. Frontend Logic (React)

The React application (`App.tsx`) serves as the control panel, managing authentication, device linking, and service configuration.

### A. Key Components
- **InkBridge (Main)**: Manages application lifecycle and Routing.
- **Dashboard View**: Visualizes the "live" data pipeline, mocking the data sent to the device.
- **Setup View**: Handles device linking and generates API Secrets.
- **Integrations View**: Configuration hub for services (Spotify, Canvas, Weather, etc.).

### B. Authentication & State
- **Auth**: Google Sign-In via Firebase.
- **State**: Manages a smooth single-page application (SPA) experience.

## 2. Backend Logic (Node.js/Firebase)

The backend acts as the bridge between the physical device and web services, aggregating data from 3rd party APIs.

### A. Core Modules
- **Spotify Integration**: Implements OAuth 2.0 Authorization Code Flow. Automatically handles token refreshing.
- **Data Providers**:
  - **Weather**: Fetches current conditions via WeatherAPI.com.
  - **Stock**: Fetches real-time quotes via Finnhub.
  - **Calendar**: Parses user iCal feeds for upcoming events.
  - **Canvas**: Proxies requests to Canvas LMS API.
  - **Travel**: Fetches commute duration via Google Maps Distance Matrix API.
  - **News**: Fetches top headlines via NewsAPI.org.

### B. Spotify OAuth Flow
1. **Trigger**: User initiates "Connect Spotify" in Frontend.
2. **Redirect**: Backend constructs authorization URL with state (User UID) and redirects to Spotify.
3. **Callback**: Spotify calls backend with code; backend exchanges code for Access/Refresh tokens.
4. **Storage**: Tokens are securely stored in Firestore.

## 3. Data Structure

Data is stored in Firestore under the `artifacts/{APP_ID}` root path.

| Collection Path | Purpose |
|----------------|---------|
| `artifacts/{APP_ID}/users/{uid}/settings/integrations` | Stores user configuration (weather cities, API keys, OAuth tokens). |
| `artifacts/{APP_ID}/devices/{deviceId}` | Maps physical hardware MAC addresses to user accounts. |
| `artifacts/{APP_ID}/users/{uid}/configurations` | Stores display layout settings (widgets, positions). |

## 4. Device Logic
- **Hardware**: ESP32 or Raspberry Pi.
- **Function**: Polls the backend for display instructions (background images and text overlays).
- **Handshake**: Uses the `/setup` endpoint to link with a user account.

## 5. API Reference

Endpoints hosted on Firebase Functions.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/setup` | GET | Handles the initial handshake. Receives a physical `device_id` and returns an API Key associated with the user account. |
| `/spotify/login` | GET | Initiates the OAuth login flow, redirecting the user to Spotify. |
| `/spotify/callback` | GET | Handles the OAuth callback, exchanges the code for tokens, and saves them to Firestore. |
| `/spotify/request` | POST | Proxies authenticated requests to the Spotify Web API (e.g., current playback). |
| `/calendar` | POST | Fetches and parses the user's iCal feed. Optional params: `range`, `url`. |
| `/canvas` | POST | Proxies requests to the Canvas LMS API. Optional params: `type`, `domain`, `token`. |
| `/weather` | POST | Fetches current weather conditions. Optional params: `location`. |
| `/stock` | POST | Fetches real-time stock quotes. Optional params: `symbol`. |
| `/travel` | POST | Fetches travel time and distance. Optional params: `origin`, `destination`, `mode`. |
| `/news` | POST | Fetches top headlines. Optional params: `category`. |
