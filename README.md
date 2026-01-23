# [InkBridge](https://inkbase01.web.app)
<p align="center">
  <img src="Resources/InkBridgeDashboard.png" width="865">
  <img src="Resources/InkBridgeIntegrations.png" height="250">
  <img src="Resources/InkBridgeSetup.png" height="250"
</p>
  
___

# InkBridge Technical Overview

InkBridge is a full-stack IoT solution designed to drive ESP32-based displays or other IOT enabled devices. It utilizes a centralized controller pattern where the "heavy lifting" (API authentication, and data aggregation) is offloaded to the cloud to minimize the processing requirements of the low-power client. While designed for low-power clients like E-Ink displays, Inkbase functions to drive any internet enabled device given an API and the capability to make web requests.

## System Architecture

- **Frontend (React)**: A web-based control panel for device linking, service configuration, and status monitoring.
- **Backend (Node.js/Firebase)**: A serverless API that aggregates data from 3rd party APIs, and handles Spotify OAuth authentication.
- **Device (ESP32)(IOT Web Enabled Device)**: An embedded client that polls the backend for live data. 

## Backend Analysis

The backend is built using Firebase Functions and Express. It serves as the bridge between the physical device and web services. The primary logic resides in `index.js`.

### Core Modules
**Data Providers:**
- **Live Data**: Time, Spotify, Calendar, Canvas LMS, Weather (Current, Forecast, History), Astronomy, Stock (Quote, History), Crypto (Quote, History), Travel, News.

**Spotify Integration**: Implements the OAuth 2.0 Authorization Code Flow. It automatically handles token refreshing if the access token is expired before fetching playback state.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/setup` | GET | Handles the initial handshake. Receives a physical `device_id` and returns an API Key associated with the user account. |
| `/spotify/login` | GET | Initiates the OAuth login flow, redirecting the user to Spotify. |
| `/spotify/callback` | GET | Handles the OAuth callback, exchanges the code for tokens, and saves them to Firestore. |
| `/spotify/request` | POST | Proxies authenticated requests to the Spotify Web API (e.g., current playback). |
| `/spotify/user_albums` | POST | Fetches user's saved albums. Optional params: `limit`, `offset`. |
| `/spotify/user_playlists` | POST | Fetches user's playlists. Optional params: `limit`, `offset`. |
| `/spotify/liked_songs` | POST | Fetches user's liked songs. Optional params: `limit`, `offset`. |
| `/spotify/followed_artists` | POST | Fetches user's followed artists. Optional params: `limit`, `after`. |
| `/spotify/playback` | POST | Controls playback state. Required param: `action` (play, pause, next, previous, seek, volume, shuffle, repeat, transfer). |
| `/spotify/devices` | POST | Fetches available Spotify Connect devices. |
| `/calendar` | POST | Fetches and parses the user's iCal feed. Optional params: `range`, `url`. |
| `/canvas` | POST | Proxies requests to the Canvas LMS API. Optional params: `type`, `domain`, `token`. |
| `/weather` | POST | Fetches current weather conditions. Optional params: `location`. |
| `/weather/forecast` | POST | Fetches weather forecast. Optional params: `location`, `days`. |
| `/weather/history` | POST | Fetches historical weather data. Optional params: `location`, `date`. |
| `/astronomy` | POST | Fetches astronomical data (sunrise, sunset, moon phase). Optional params: `location`. |
| `/stock` | POST | Fetches real-time stock quotes. Optional params: `symbol`. |
| `/stock/array` | POST | Fetches historical stock candle data. Optional params: `symbol`, `days`. |
| `/crypto` | POST | Fetches real-time cryptocurrency quotes. Optional params: `symbol`. |
| `/crypto/array` | POST | Fetches historical cryptocurrency price data. Optional params: `symbol`, `days`. |
| `/travel` | POST | Fetches travel time and distance. Optional params: `origin`, `destination`, `mode`. |
| `/news` | POST | Fetches top headlines. Optional params: `category`. |

## Frontend Analysis

The frontend is a React application (`App.tsx`) initialized with Firebase. It uses `lucide-react` for iconography and manages state for a smooth single-page application (SPA) experience.

### Key Components

**InkBridge (Main)**: Manages the application lifecycle, including Authentication (Google Sign-In) and View Routing.

**Dashboard View**: Visualizes the "live" device status. Displays currently enabled integrations.

**Setup View**: Provides the interface to link a physical device. It generates API Secrets (`sk_...`) and provides a firmware logic snippet for the user.

**Integrations View**: A configuration hub where users enable services and input credentials (API keys, cities, iCal URLs).

### Data Management

Data is stored in Firestore with the following structure:

| Collection Path | Purpose |
|----------------|---------|
| `artifacts/{APP_ID}/users/{uid}/settings/integrations` | Stores user configuration (weather cities, API keys, OAuth tokens). |
| `artifacts/{APP_ID}/devices/{deviceId}` | Maps physical hardware MAC addresses to user accounts. |

## Key Mechanisms

### Device Setup Flow

The application implements a full device API certification protocol to allow for safe and secure data access from real-time sources.

1. **Call /setup**: Users web enabled device makes a /setup request to the API url with an imbedded device ID (MAC Address).
2. **Function Checks**: The /setup function triggers a database check parsing for devices with a device ID sent in the initial /setup request.
3. **Return**: The /setup function returns a json following a success or failure.
   
*Example Success Return*: 
```
{
  status: "success",
  uid: 001A2B3C4D5E,
  api_key: sk_.........,
  friendly_user_id: "My Username",
  message: "Setup successful"
}
```

*Example Failure Return*:
```
{
  status: "error",
  message: "Internal Server Error"
}
```
### Spotify OAuth Flow

The application implements a full server-side OAuth flow:

1. **Trigger**: User clicks "Connect Spotify" in the Frontend.
2. **Redirect**: Backend constructs the authorization URL with state (User UID) and redirects to Spotify.
3. **Callback**: Spotify calls the backend with a code.
4. **Storage**: Backend exchanges code for Access/Refresh tokens and stores them securely in Firestore.
5. **User Calls any `/spotify` Request**: Triggers `makeSpotifyRequest(uid, endpoint, method = "GET", body = null, deviceId = null)` which checks users tokens and refreshed if needed by calling `refreshSpotifyToken(uid, refreshToken, deviceId)`. `makeSpotifyRequest()` returns the response json from the Spotify Web API along with its status. Other `/spotify` calls like `/spotify/user_albums` return a parsed json with more specific information in turn making the returned json smaller and faster to fetch by a device.

*Example `/spotify/user_albums` Success Return*:
```
{
  "status": "success",
  "data": [
    {
      "name": "Random Access Memories",
      "artist": "Daft Punk",
      "image": "https://i.scdn.co/image/ab67616d0000b2734268e5971488c2278923e595",
      "uri": "spotify:album:4m2880jivSbbyEGqfTD7P6"
    },
    {
      "name": "IGOR",
      "artist": "Tyler, The Creator",
      "image": "https://i.scdn.co/image/ab67616d0000b273704f23d8839443c683c39178",
      "uri": "spotify:album:5zi7WsKlIiUXv09tbGLKsE"
    }
  ]
}
```
*Example `/spotify/user_albums` Failure Returns*:
```
{
  "status": "error",
  "message": "Request failed with status code 401: Invalid access token"
}

{
  "status": "error",
  "message": "Missing UID"
}
```

### Calendar Flow ###

This application parses an ICS and returns a smaller easily read json file for events in the next time frame(specified by user). 
1. **Trigger**: User calls `/calendar` with optional parameters of `url` (the ics url), and `range` (1d, 3d, 1w, 1m). If not specified the function defaults to the parameters defined in the integrations page.
2. **Return**: Returns a json with the users next calendar events and a success or failure message.

*Example Success Return*:
```
{
  "status": "success",
  "data": [
    {
      "summary": "Aerospace Meeting",
      "start": "2026-01-26T16:00:00.000Z",
      "end": "2026-01-26T17:15:00.000Z",
      "location": "Airplane Corp."
    },
    {
      "summary": "InkBridge Sync",
      "start": "2026-01-27T10:00:00.000Z",
      "end": "2026-01-27T11:00:00.000Z",
      "location": null
    },
    {
      "summary": "Food Pantry Volunteering",
      "start": "2026-01-28T09:00:00.000Z",
      "end": "2026-01-28T13:00:00.000Z",
      "location": "null"
    }
  ]
}
```
*Example Failure Returns*: 
```
{
  "status": "error",
  "message": "Error: Invalid URI \"htps://bad-url.com/calendar.ics\""
}

{
  "status": "error",
  "message": "User settings not found"
}

{
  "status": "error",
  "message": "Calendar not connected"
}
```

### Canvas LMS FLow ###
1. **Trigger**: User request `/canvas` with optional parameters `type` ("grades" or "assignments"), `domain` (Users canvas domain url), `token` (Users canvas API token).
2. **Return**: Returns a json containing data and a success or failure message.

*Example Assignments Success Return*:
```
{
  "status": "success",
  "data": [
    {
      "id": 104857,
      "title": "Calculus III - Weekly Problem Set 4",
      "due_at": "2026-01-26T23:59:00Z",
      "type": "assignment"
    },
    {
      "id": 104922,
      "title": "Ethics in Spaceflight - Draft Submission",
      "due_at": "2026-01-27T14:00:00Z",
      "type": "assignment"
    },
    {
      "id": 105101,
      "title": "Lab Safety Quiz",
      "due_at": "2026-01-28T11:59:00Z",
      "type": "quiz"
    }
  ]
}
```
*Example Grades Success Return*:
```
{
  "status": "success",
  "data": [
    {
      "course": "Materials Science",
      "grade": 92.5,
      "letter": "A-"
    },
    {
      "course": "Calculus 3",
      "grade": 88.0,
      "letter": "B+"
    },
    {
      "course": "Engineering Ethics",
      "grade": "N/A",
      "letter": "N/A"
    }
  ]
}
```
*Example Failure Returns*:
```
{
  "status": "error",
  "message": "Canvas not connected"
}

{
  "status": "error",
  "message": "Canvas API Error 401: {\"status\":\"unauthenticated\",\"errors\":[{\"message\":\"Invalid access token.\"}]}"
}
```

### Weather Flow ###
Uses `weatherapi.com` for realtime data and forcast fetching along with astronomy data.
1. **Trigger**: User request `/weather` or `/astronomy` with the optional parameter of `location`. 
2. **Return**: Returns a json containing data and a success or failure message.

*Example `/weather` Success Return*:
```
{
  "status": "success",
  "data": {
    "temp": 28,
    "condition": "Light snow",
    "description": "Light snow",
    "city": "Boulder"
  }
}
```

*Example `/weather` Failure Return*:
```
{
  "status": "error",
  "message": "Weather location not set"
}
```

*Example `/weather/forcast` Success Return*:
```
{
  "status": "success",
  "data": {
    "city": "Boulder",
    "forecast": [
      {
        "date": "2026-01-23",
        "max_temp": 34.2,
        "min_temp": 18.5,
        "condition": "Patchy light snow"
      },
      {
        "date": "2026-01-24",
        "max_temp": 41.0,
        "min_temp": 22.1,
        "condition": "Partly cloudy"
      },
      {
        "date": "2026-01-25",
        "max_temp": 45.3,
        "min_temp": 28.4,
        "condition": "Sunny"
      }
    ]
  }
}
```
*Example `/weather/forcast` Failure Return*:
```
{
  "status": "error",
  "message": "WeatherAPI Error 403: {\"error\":{\"code\":2008,\"message\":\"API key has been disabled.\"}}"
}
```
*Example `/weather/history` Success Return*:
```
{
  "status": "success",
  "data": {
    "city": "Boulder",
    "history": [
      { "date": "2026-01-17", "avg_temp": 38.5, "condition": "Overcast" },
      { "date": "2026-01-18", "avg_temp": 42.1, "condition": "Sunny" },
      { "date": "2026-01-19", "avg_temp": 40.0, "condition": "Partly cloudy" },
      { "date": "2026-01-20", "avg_temp": 35.6, "condition": "Light snow" },
      { "date": "2026-01-21", "avg_temp": 29.8, "condition": "Heavy snow" },
      { "date": "2026-01-22", "avg_temp": 25.4, "condition": "Mist" },
      { "date": "2026-01-23", "avg_temp": 28.2, "condition": "Light snow" }
    ]
  }
}
```
*Example `/weather/history` Failure Return*:
```
{
  "status": "error",
  "message": "Missing UID"
}
```
*Example `/astronomy` Success Return*:
```
{
  "status": "success",
  "data": {
    "location": "Boulder",
    "sunrise": "07:18 AM",
    "sunset": "05:12 PM",
    "moonrise": "09:45 AM",
    "moonset": "08:30 PM",
    "moon_phase": "Waxing Crescent",
    "moon_illumination": "23",
    "is_sun_up": 1
  }
}
```

*Example `/astronomy` Failure Return*:
```
{
  "status": "error",
  "message": "User settings not found"
}
```
### Stock Flow ###
Driven by Finnhub API to pull realtime stock information.
1. **Trigger**: User calls `/stock` with optional parameter of `symbol`.
2. **Return**: Returns a json with data and a success or failure message.

*Example `/stock` Success Return*:
```
{
  "status": "success",
  "data": {
    "symbol": "NVDA",
    "price": 142.50,
    "percent": 2.45,
    "high": 144.10,
    "low": 139.80
  }
}
```
*Example `/stock` Failure Return*:
```
{
  "status": "error",
  "message": "Finnhub Error 429: {\"error\":\"API limit reached. Please try again later. Thanks for using Finnhub.\"}"
}
```

*Example `/stock/array` Success Return*:
```
{
  "status": "success",
  "data": [
    {
      "date": "2026-01-16",
      "price": 224.50
    },
    {
      "date": "2026-01-17",
      "price": 226.10
    },
    {
      "date": "2026-01-18",
      "price": 225.80
    },
    {
      "date": "2026-01-19",
      "price": 228.45
    },
    {
      "date": "2026-01-20",
      "price": 230.15
    },
    {
      "date": "2026-01-21",
      "price": 229.90
    },
    {
      "date": "2026-01-22",
      "price": 231.20
    }
  ]
}
```
User requests 7 days of history for "AAPL" (Apple). Logic: The code maps the Finnhub t (timestamp) and c (closing price) arrays into a clean object structure. The dates correspond to the daily close.

### Crypto Flow ###
Driven by CoinMarketCap API to pull realtime crypto information.
1. **Trigger**: User calls `/crypto` with optional parameter of `symbol`.
2. **Return**: Returns a json with data and a success or failure message.

*Example `/crypto` Success Return*:
```
{
  "status": "success",
  "data": {
    "symbol": "BTC",
    "name": "Bitcoin",
    "price": 104250.75,
    "percent_change_24h": 3.45
  }
}
```
*Example `/crypto` Failure Return*:
```
{
  "status": "error",
  "message": "CoinMarketCap Error 401: {\"status\":{\"error_code\":1002,\"error_message\":\"API key missing.\",\"credit_count\":0}}"
}
```
*Example `/crypto/array` Success Return*:
```
{
  "status": "success",
  "data": [
    {
      "date": "2026-01-16",
      "price": 3850.20
    },
    {
      "date": "2026-01-17",
      "price": 3910.55
    },
    {
      "date": "2026-01-18",
      "price": 3895.10
    },
    {
      "date": "2026-01-19",
      "price": 4020.80
    },
    {
      "date": "2026-01-20",
      "price": 4150.00
    },
    {
      "date": "2026-01-21",
      "price": 4100.25
    },
    {
      "date": "2026-01-22",
      "price": 4080.50
    },
    {
      "date": "2026-01-23",
      "price": 4125.75
    }
  ]
}
```
*Example `/crypto/array` Failure Return*:
```
{
  "status": "error",
  "message": "There is no data for the symbol INVALIDCOIN ."
}
```
### Travel Time Flow ###
Driven by Google Maps Distance Matrix API to pull realtime travel and traffic information.
1. **Trigger**: User calls `/travel` with optional parameters of  `origin`, `destination`, `mode`.
2. **Return**: Returns a json with data and a success or failure message.

*Example `/travel` Success Return*:
```
{
  "status": "success",
  "data": {
    "duration": "42 mins",
    "distance": "44.5 mi",
    "origin": "Boulder, CO, USA",
    "destination": "Denver International Airport, 8500 Peña Blvd, Denver, CO 80249, USA",
    "mode": "driving"
  }
}
```

*Example `/travel` Failure Return*:
```
{
  "status": "error",
  "message": "Route not found: ZERO_RESULTS"
}
```

### News Headlines Flow ###
Driven by NewsAPI to pull current headlines from different categories of interest.
1. **Trigger**: User calls `/news` with optional parameter `category`.
2. **Return**: Returns a json with data and a success or failure message.

*Example `/news` Success Return*:
```
{
  "status": "success",
  "data": [
    {
      "title": "NVIDIA announces new RTX 50-series GPUs with AI capabilities",
      "source": "The Verge"
    },
    {
      "title": "SpaceX Starship successfully completes orbital refueling test",
      "source": "TechCrunch"
    },
    {
      "title": "Apple releases iOS 19.3 with major security patches",
      "source": "MacRumors"
    },
    {
      "title": "Microsoft and OpenAI unveil GPT-6 preview for enterprise",
      "source": "CNBC"
    },
    {
      "title": "New solid-state battery breakthrough promises 1000-mile EV range",
      "source": "Ars Technica"
    }
  ]
}
```
*Example `/news` Failure Return*:
```
{
  "status": "error",
  "message": "NewsAPI Error 429: {\"status\":\"error\",\"code\":\"rateLimited\",\"message\":\"You have made too many requests recently. Developer accounts are limited to 100 requests over a 24 hour period (50 requests available every 12 hours).\"}"
}
```

## TO-DO
### Backend Development (Node JS)

### Frontend Development (Typescript)

