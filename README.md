# [InkBridge](https://inkbase01.web.app),  [InkBridge ESP32 Library](https://github.com/Cgriz365/InkBridge-ESP32)
<p align="center">
  <img src="Resources/InkBridgeDashboard.png" width="865">
  <img src="Resources/InkBridgeIntegrations.png" width="400">
  <img src="Resources/InkBridgeSetup.png" width="400"
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
| `/calendar` | POST | Fetches and parses the user's iCal feed. Optional params: `range`, `url`, `simple`. |
| `/canvas` | POST | Proxies requests to the Canvas LMS API. Optional params: `type`, `domain`, `token`. |
| `/canvas/courses` | POST | Fetches list of active courses with progress. |
| `/canvas/course` | POST | Fetches specific course details (todos, feedback). Params: `course_id` or `course_name`. |
| `/canvas/assignment` | POST | Fetches specific assignment details. Params: `course_id`, `assignment_id` or `assignment_name`. |
| `/weather` | POST | Fetches current weather conditions. Optional params: `location`. |
| `/weather/forecast` | POST | Fetches weather forecast. Optional params: `location`, `days`. |
| `/weather/history` | POST | Fetches historical weather data. Optional params: `location`, `date`. |
| `/astronomy` | POST | Fetches astronomical data (sunrise, sunset, moon phase). Optional params: `location`. |
| `/stock` | POST | Fetches real-time stock quotes. Optional params: `symbol`. |
| `/stock/array` | POST | Fetches historical stock candle data. Optional params: `symbol`, `days`, `interval`. |
| `/crypto` | POST | Fetches real-time cryptocurrency quotes. Optional params: `symbol`. |
| `/crypto/array` | POST | Fetches historical cryptocurrency price data. Optional params: `symbol`, `days`, `interval`. |
| `/travel` | POST | Fetches travel time and distance. Optional params: `origin`, `destination`, `mode`. |
| `/news` | POST | Fetches top headlines. Optional params: `category`, `search`, `limit`. |

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
1. **Trigger**: User calls `/calendar` with optional parameters of `url` (the ics url), `range` (1d, 3d, 1w, 1m), and `simple` (boolean). If not specified the function defaults to the parameters defined in the integrations page.
2. **Return**: Returns a json with the users next calendar events and a success or failure message.

*Example Success Return*:
```
{
  "status": "success",
  "data": {
    "calendar": {
      "name": "Work Calendar",
      "timezone": "America/New_York",
      "description": null
    },
    "events": [
      {
        "name": "Aerospace Meeting",
        "start": "2026-01-26T16:00:00.000Z",
        "end": "2026-01-26T17:15:00.000Z",
        "duration": 4500000,
        "location": "Airplane Corp.",
        "description": "Discussing the new wing design.",
        "transparency": "Timed Event",
        "structured_location": null,
        "alarm": "-PT15M",
        "organizer": "Boss Man"
      }
    ]
  }
}
```

*Example Simple Success Return (`simple=true`)*:
```
{
  "status": "success",
  "data": {
    "calendar": { ... },
    "events": [
      {
        "name": "InkBridge Sync",
        "start": "2026-01-27T10:00:00.000Z",
        "end": "2026-01-27T11:00:00.000Z",
        "location": null
      }
    ]
  }
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
The Canvas integration supports multiple endpoints to fetch specific data types.

**Endpoints:**
1. **`/canvas`**: Legacy endpoint. Fetches assignments or grades based on `type`.
2. **`/canvas/courses`**: Fetches a list of active courses.
3. **`/canvas/course`**: Fetches details for a specific course (todos, feedback). Requires `course_id` or `course_name`.
4. **`/canvas/assignment`**: Fetches details for a specific assignment. Requires `course_id` and (`assignment_id` or `assignment_name`).

*Example `/canvas/courses` Success Return*:
```
{
  "status": "success",
  "data": [
    {
      "name": "Introduction to Aerospace Engineering",
      "id": 101,
      "state": "available",
      "progress": 94.5,
      "calendar_link": "https://canvas.instructure.com/feeds/calendars/course_101.ics"
    }
  ]
}
```

*Example `/canvas/course` Success Return*:
```
{
  "status": "success",
  "data": {
    "todos": [
      {
        "name": "Weekly Problem Set 5",
        "id": 505,
        "due_date": "2026-02-01T23:59:00Z",
        "description": "Complete problems 1-10 in Chapter 5.",
        "type": ["online_upload"]
      }
    ],
    "feedback": [
      {
        "assignment_name": "Midterm Exam",
        "score": 92,
        "grade": "A-",
        "graded_at": "2026-01-20T14:30:00Z",
        "feedback": "Great work on the derivation."
      }
    ]
  }
}
```

*Example `/canvas/assignment` Success Return*:
```
{
  "status": "success",
  "data": {
    "course_name": "Calculus III",
    "course_id": 102,
    "assignment_name": "Weekly Problem Set 5",
    "id": 505,
    "marked_complete": false,
    "dismissed": false,
    "submission_status": "unsubmitted",
    "grade": null,
    "html_url": "https://canvas.instructure.com/courses/102/assignments/505"
  }
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
    "low": 139.80,
    "open": 140.00,
    "previous_close": 139.10
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
1. **Trigger**: User calls `/news` with optional parameters `category`, `search`, and `limit`.
2. **Return**: Returns a json with data and a success or failure message.

*Example `/news` Success Return*:
```
{
  "status": "success",
  "data": [
    {
      "title": "NVIDIA announces new RTX 50-series GPUs with AI capabilities",
      "source": "The Verge",
      "description": "NVIDIA has unveiled its latest generation of graphics cards...",
      "published_at": "2026-01-15T14:30:00Z"
    },
    {
      "title": "SpaceX Starship successfully completes orbital refueling test",
      "source": "TechCrunch",
      "description": "In a major milestone for deep space exploration...",
      "published_at": "2026-01-15T12:15:00Z"
    },
    {
      "title": "Apple releases iOS 19.3 with major security patches",
      "source": "MacRumors",
      "description": "The latest iOS update addresses critical vulnerabilities...",
      "published_at": "2026-01-15T10:00:00Z"
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

*Documentation primarily written by AI (Gemini + Claude), however it has been thorougly checked* 
