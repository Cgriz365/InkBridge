InkBridge System Logic Flow1. Webpage Logic (App.tsx)The React application acts as the control center. It manages state locally and synchronizes with Firebase Firestore.A. Initialization \& AuthApp Load: Firebase SDK initializes.Auth Listener: Checks if a user is signed in.If No: Shows Login Screen.If Yes:Calls ensureUserApiKey(): Checks Firestore for an existing API Key. If missing, generates a secure random key (sk\_...) and saves it.Calls loadUserConfigs(): Fetches the list of saved layouts.B. Configuration ManagementCreate: createNewConfig adds a default document to users/{uid}/configurations.Edit:Drag \& Drop / Resize: Updates local state (screens array) with grid-snapped coordinates.Widget Config: Updates specific widget properties (e.g., "city", "symbol").Global Settings: Updates app-wide settings like ical\_url or canvas\_token.Save: saveToCloud pushes the current state to Firestore. It clamps widgets to screen bounds before saving to ensure validity.C. Device LinkingUser Action: User enters a Device ID (MAC Address) in the "Device Manager" sidebar.Logic (registerDevice):Cleans the ID (uppercase, removes colons).Writes to devices/{deviceId} in Firestore.Stores: ownerId, apiKey (the user's secret key), and activeConfigId.Result: The device is now "claimed" and can authenticate via the API.2. Cloud Functions Logic (functions/index.js)The backend acts as the intelligence layer, converting raw config data into render-ready assets for the ESP32.A. Route: /setup (Device Handshake)Trigger: ESP32 boots up or enters setup mode.Input: x-device-id (MAC Address).Process:Looks up devices/{deviceId} in Firestore.If Found: Returns the User's api\_key and friendly\_user\_id.If Not Found: Returns status: "pending".B. Route: /display (Content Generation)Trigger: ESP32 wakes from deep sleep to refresh screen.Input: x-device-id, x-api-key.Process:Authentication:Fetches devices/{deviceId}.Verifies the provided x-api-key matches the stored key.Security: Ensures only the claimed owner can control the display.Config Retrieval:Gets activeConfigId and ownerId from the device doc.Fetches the actual layout from users/{ownerId}/configurations/{configId}.Image Generation (The "Static" Layer):Calls generateStaticSVG().Iterates through all widgets in the config.Draws Borders, Icons (Cloud, Chart, Clock), and Static Labels (e.g., "NEW YORK").Converts the resulting SVG to a Base64 Data URI.Data Hydration (The "Dynamic" Layer):Iterates through widgets again to fetch live data.Weather: Calls Mock API (or OpenWeather).Stock: Calls Mock API (or Finnhub).Calendar: Fetches \& parses the user's iCal URL.Canvas: Fetches assignments using the Canvas Token.Overlay Construction:Creates a JSON list of text elements (value, x, y, font, size) representing the changing data (e.g., "72°F", "Meeting at 2pm").Calculates positions relative to the widget coordinates.Output: JSON containing:background\_image\_url: The static parts (Base64 image).overlays: The dynamic text list.refresh\_rate: How long the ESP32 should sleep.3. Data Structure Relationshipusers/{uid}: Stores User Profile \& API Key..../configurations/{configId}: Stores the visual layout (Widgets, positions, global settings).devices/{deviceId}: The "Link" document. Maps a physical MAC address to a specific User ID and API Key.4. API ReferenceDetailed documentation for the Cloud Function endpoints consumed by the ESP32.GET /setupUsed by the device during initial boot or factory reset to claim ownership.Parameters (Header or Query String):device\_id (string, required): The unique MAC address of the ESP32 (e.g., 9C9E6E52FC28).Response (JSON):Success:{

&nbsp; "status": "success",

&nbsp; "api\_key": "sk\_...",           // The secret key to save in NVS

&nbsp; "friendly\_user\_id": "John Doe", // Name of the user who claimed the device

&nbsp; "message": "Setup successful"

}

Pending (Device not yet claimed on Webpage):{

&nbsp; "status": "pending",

&nbsp; "message": "Device not registered."

}

GET /displayThe main loop endpoint. Fetches the rendered background and dynamic text overlays.Parameters (Header or Query String):device\_id (string, required): The unique MAC address.api\_key (string, required): The secret key obtained from /setup.color\_mode (string, optional): "1bit" (default, for E-Ink) or "color" (for LCD/TFT).Response (JSON):{

&nbsp; "status": "success",

&nbsp; "message": "Data refreshed",

&nbsp; "refresh\_rate": 900,              // Recommended sleep time in seconds

&nbsp; "firmware\_reset": false,          // If true, device should reboot immediately

&nbsp; "color\_mode": "1bit",             // Echo of requested mode

&nbsp; "background\_image\_url": "data:image/svg+xml;base64,...", // Static elements (borders, icons)

&nbsp; "image\_filename": "bg\_config1.svg", // Filename for caching logic

&nbsp; "overlays": \[                     // Dynamic text elements to draw on top

&nbsp;   {

&nbsp;     "type": "text",

&nbsp;     "value": "72°F",

&nbsp;     "x": 120,

&nbsp;     "y": 45,

&nbsp;     "size": 32,

&nbsp;     "font": "arial",

&nbsp;     "color": "black",

&nbsp;     "align": "center"

&nbsp;   },

&nbsp;   // ... more overlays

&nbsp; ]

}



