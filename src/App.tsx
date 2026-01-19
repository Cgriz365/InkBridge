import { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getFirestore, doc, setDoc, getDoc, collection, query, getDocs, onSnapshot, where
} from 'firebase/firestore';
import {
  getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, type User
} from 'firebase/auth';
import {
  Wifi, Key, Cloud, TrendingUp, Calendar, BookOpen,
  Check, Copy, Eye, EyeOff, User as UserIcon, Server, RefreshCw, Music,
  Plus, X, Trash2, Home, Activity, Sliders, Smartphone, Cpu, LayoutDashboard, Settings, MapPin, Newspaper, ChevronDown,
  type LucideIcon
} from 'lucide-react';

// --- TYPES ---
interface Service {
  id: string;
  name: string;
  icon: LucideIcon;
  description: string;
}

interface IntegrationState {
  weather_enabled: boolean;
  weather_city: string;
  weather_api_key: string;
  stock_enabled: boolean;
  stock_symbol: string;
  stock_api_key: string;
  calendar_enabled: boolean;
  ical_url: string;
  calendar_range: string;
  canvas_enabled: boolean;
  canvas_domain: string;
  canvas_token: string;
  spotify_enabled: boolean;
  travel_enabled: boolean;
  travel_origin: string;
  travel_destination: string;
  travel_mode: string;
  travel_api_key: string;
  news_enabled: boolean;
  news_category: string;
  news_api_key: string;
  [key: string]: string | boolean; // Index signature for dynamic access
}

interface ActiveIntegrationCardProps {
  serviceId: string;
  onRemove: () => void;
  isEnabled: boolean;
  children: React.ReactNode;
}

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyBPpGfOASHF3vFz2p_aUeF-HFun_curbJo",
  authDomain: "inkbase01.firebaseapp.com",
  projectId: "inkbase01",
  storageBucket: "inkbase01.firebasestorage.app",
  messagingSenderId: "477027384144",
  appId: "1:477027384144:web:18bfffe2d3e2b4685eca55"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const appId = "default-app-id";

// --- CONSTANTS ---
const AVAILABLE_SERVICES: Service[] = [
  { id: 'weather', name: 'Weather', icon: Cloud, description: 'Current conditions via WeatherAPI.com.' },
  { id: 'stock', name: 'Stocks', icon: TrendingUp, description: 'Track market prices via Finnhub.' },
  { id: 'calendar', name: 'Google Calendar', icon: Calendar, description: 'Upcoming events from iCal feed.' },
  { id: 'canvas', name: 'Canvas LMS', icon: BookOpen, description: 'Assignments and due dates.' },
  { id: 'spotify', name: 'Spotify', icon: Music, description: 'Current playback information.' },
  { id: 'travel', name: 'Travel Time', icon: MapPin, description: 'Commute time via Google Maps.' },
  { id: 'news', name: 'News Headlines', icon: Newspaper, description: 'Top headlines via NewsAPI.org.' },
];

const INITIAL_INTEGRATIONS: IntegrationState = {
  weather_enabled: false,
  weather_city: "",
  weather_api_key: "",
  stock_enabled: false,
  stock_symbol: "AAPL",
  stock_api_key: "",
  calendar_enabled: false,
  ical_url: "",
  calendar_range: "1d",
  canvas_enabled: false,
  canvas_domain: "",
  canvas_token: "",
  spotify_enabled: false,
  travel_enabled: false,
  travel_origin: "",
  travel_destination: "",
  travel_mode: "driving",
  travel_api_key: "",
  news_enabled: false,
  news_category: "general",
  news_api_key: ""
};

// --- SUB-COMPONENTS ---
// Defined outside the main component to prevent re-renders and scope issues

const NavButton = ({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: LucideIcon; label: string }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all text-sm font-medium ${active ? 'text-black' : 'text-stone-500'} hover:bg-stone-100 hover:text-black`}
  >
    <Icon size={16} strokeWidth={2} />
    {label}
  </button>
);

const ServiceCard = ({ service, onAdd }: { service: Service; onAdd: () => void }) => {
  const Icon = service.icon;
  return (
    <button
      onClick={onAdd}
      className="flex items-start gap-4 p-4 bg-white hover:bg-stone-50 rounded-lg shadow-sm hover:shadow-md transition-all text-left group border border-stone-200 hover:border-stone-400 w-full"
    >
      <div className="p-3 bg-stone-50 rounded-md text-black group-hover:text-black transition-colors border border-stone-100">
        <Icon size={24} strokeWidth={1.5} />
      </div>
      <div className="flex-1">
        <h3 className="font-bold text-black text-base mb-1">{service.name}</h3>
        <p className="text-xs text-black leading-relaxed">{service.description}</p>
      </div>
      <div className="self-center opacity-0 group-hover:opacity-100 transition-opacity text-black">
        <Plus size={20} />
      </div>
    </button>
  );
};

const InputField = ({ label, value, field, onChange, placeholder, type = "text", subtext }: { label: string; value: string; field: string; onChange: (f: string, v: string) => void; placeholder?: string; type?: string; subtext?: string }) => (
  <div className="mb-5 last:mb-0">
    <label className="block text-[10px] uppercase tracking-wider font-bold text-black mb-1.5 ml-1">
      {label}
    </label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(field, e.target.value)}
      placeholder={placeholder}
      className="w-full bg-stone-50 shadow-inner border border-stone-200 rounded-md px-3 py-2 text-sm text-black focus:ring-1 focus:ring-black focus:border-black outline-none transition-all placeholder:text-stone-400 font-mono"
    />
    {subtext && <p className="text-[10px] text-black mt-1 ml-1 italic">{subtext}</p>}
  </div>
);

const ToggleGroup = ({ label, value, field, onChange, options, subtext }: { label: string; value: string; field: string; onChange: (f: string, v: string) => void; options: { value: string; label: string }[]; subtext?: string }) => (
  <div className="mb-5 last:mb-0">
    <label className="block text-[10px] uppercase tracking-wider font-bold text-black mb-1.5 ml-1">
      {label}
    </label>
    <div className="flex gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(field, opt.value)}
          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${value === opt.value ? 'bg-stone-100 text-black font-bold' : 'text-stone-500 hover:text-black hover:bg-stone-100'}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
    {subtext && <p className="text-[10px] text-black mt-1 ml-1 italic">{subtext}</p>}
  </div>
);

const ActiveIntegrationCard = ({ serviceId, onRemove, isEnabled, children }: ActiveIntegrationCardProps) => {
  const service = AVAILABLE_SERVICES.find(s => s.id === serviceId);
  if (!service) return null;
  const Icon = service.icon;

  return (
    <div className={`bg-white rounded-lg border transition-all animate-in slide-in-from-bottom-2 fade-in ${isEnabled ? 'border-stone-300 shadow-md' : 'border-stone-100 opacity-75'}`}>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4 border-b border-stone-100 pb-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-md ${isEnabled ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-400'}`}>
              <Icon size={20} />
            </div>
            <span className="font-bold text-lg text-black">{service.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRemove}
              className="p-1.5 hover:bg-red-50 text-stone-300 hover:text-red-500 rounded transition-colors"
              title="Remove Service"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        <div>
          {children}
        </div>
      </div>
    </div>
  );
};

// --- MAIN COMPONENT ---
export default function InkBridge() {
  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Navigation State
  const [currentView, setCurrentView] = useState<'dashboard' | 'integrations' | 'setup'>('dashboard');

  // InkBridge Data
  const [userApiKey, setUserApiKey] = useState<string>("");
  const [showInkKey, setShowInkKey] = useState(false);
  const [defaultConfigId, setDefaultConfigId] = useState<string | null>(null);

  // Device Linking
  const [deviceIdInput, setDeviceIdInput] = useState("");
  const [linkStatus, setLinkStatus] = useState<string>("");
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [userDevices, setUserDevices] = useState<string[]>([]);
  const [deviceStatus, setDeviceStatus] = useState<'linked' | 'online'>('linked');
  const [lastSync, setLastSync] = useState<number | null>(null);

  // Integrations State
  const [integrations, setIntegrations] = useState<IntegrationState>(INITIAL_INTEGRATIONS);

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const isInitialLoad = useRef(true);

  // Spotify Playback State
  const [spotifyPlayback, setSpotifyPlayback] = useState<any>(null);
  const [loadingSpotify, setLoadingSpotify] = useState(false);

  // Calendar State
  const [calendarEvents, setCalendarEvents] = useState<any[] | null>(null);
  const [loadingCalendar, setLoadingCalendar] = useState(false);

  // Canvas State
  const [canvasAssignments, setCanvasAssignments] = useState<any[] | null>(null);
  const [loadingCanvas, setLoadingCanvas] = useState(false);

  // Weather State
  const [weatherData, setWeatherData] = useState<any>(null);
  const [loadingWeather, setLoadingWeather] = useState(false);

  // Stock State
  const [stockData, setStockData] = useState<any>(null);
  const [loadingStock, setLoadingStock] = useState(false);

  // Travel State
  const [travelData, setTravelData] = useState<any>(null);
  const [loadingTravel, setLoadingTravel] = useState(false);

  // News State
  const [newsData, setNewsData] = useState<any>(null);
  const [loadingNews, setLoadingNews] = useState(false);

  // NEW: Listen for Device Handshake
  useEffect(() => {
    if (!activeDeviceId || !user) return;

    // Reset status when switching devices
    setDeviceStatus('linked');
    setLastSync(null);

    const deviceRef = doc(db, "artifacts", appId, "devices", activeDeviceId);

    // Subscribe to real-time updates
    const unsubscribe = onSnapshot(deviceRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.lastHandshake) {
          setDeviceStatus('online');
          // Convert Firestore timestamp to millis if needed
          const millis = data.lastHandshake.toMillis ? data.lastHandshake.toMillis() : Date.now();
          setLastSync(millis);
        } else {
          setDeviceStatus('linked');
        }
      }
    });

    return () => unsubscribe();
  }, [activeDeviceId, user]);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // --- AUTH & LOAD ---
  useEffect(() => {
    const loadUserData = async (uid: string) => {
      try {
        // 1. Get/Generate InkBridge Secret Key
        const userDocRef = doc(db, "artifacts", appId, "users", uid);
        const userSnap = await getDoc(userDocRef);

        if (userSnap.exists()) {
          const data = userSnap.data();
          if (data.apiKey) setUserApiKey(data.apiKey);
        } else {
          const newKey = "sk_" + Math.random().toString(36).substr(2, 9) + Math.random().toString(36).substr(2, 9);
          await setDoc(userDocRef, { apiKey: newKey }, { merge: true });
          setUserApiKey(newKey);
        }


        // 3. Ensure a Default Configuration exists
        const configsRef = collection(db, "artifacts", appId, "users", uid, "configurations");
        const q = query(configsRef);
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          setDefaultConfigId(querySnapshot.docs[0].id);
        } else {
          const newConfigRef = doc(collection(db, "artifacts", appId, "users", uid, "configurations"));
          const newConfig = {
            name: "Default",
            ownerId: uid,
            created: Date.now(),
            screens: [{ id: "s1", name: "Home", widgets: [] }],
            device_config: { width: 400, height: 300, sleep_seconds: 900 }
          };
          await setDoc(newConfigRef, newConfig);
          setDefaultConfigId(newConfigRef.id);
        }

        // 4. Check for linked devices
        const devicesRef = collection(db, "artifacts", appId, "devices");
        const qDevice = query(devicesRef, where("ownerId", "==", uid));
        const deviceSnapshot = await getDocs(qDevice);

        if (!deviceSnapshot.empty) {
          const devices = deviceSnapshot.docs.map(doc => doc.id);
          setUserDevices(devices);
          setActiveDeviceId(devices[0]);
        }
      } catch (e) {
        console.error("Load Error", e);
      }
    };

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        await loadUserData(currentUser.uid);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // NEW: Load Settings when Device Changes
  useEffect(() => {
    if (!user || !activeDeviceId) return;

    const loadDeviceSettings = async () => {
      const settingsRef = doc(db, "artifacts", appId, "users", user.uid, "settings", activeDeviceId);
      const settingsSnap = await getDoc(settingsRef);

      if (settingsSnap.exists()) {
        setIntegrations((prev) => ({ ...prev, ...settingsSnap.data() }));
      } else {
        setIntegrations(INITIAL_INTEGRATIONS);
      }
    };
    loadDeviceSettings();
  }, [activeDeviceId, user]);

  // --- ACTIONS ---
  const handleLogin = async () => { await signInWithPopup(auth, new GoogleAuthProvider()); };
  const handleLogout = async () => { await signOut(auth); setUser(null); };

  const saveIntegrations = async () => {
    if (!user || !activeDeviceId) return;
    setSaveState('saving');
    try {
      const settingsRef = doc(db, "artifacts", appId, "users", user.uid, "settings", activeDeviceId);
      await setDoc(settingsRef, integrations, { merge: true });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch (e) {
      console.error(e);
      setSaveState('idle');
    }
  };

  // Auto-save Effect
  useEffect(() => {
    if (loading || !user) return;
    
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      return;
    }

    const timeoutId = setTimeout(() => saveIntegrations(), 1000);
    return () => clearTimeout(timeoutId);
  }, [integrations, loading, user]);

  const registerDevice = async () => {
    if (!user || !deviceIdInput || !defaultConfigId) return;
    const cleanId = deviceIdInput.trim().toUpperCase().replace(/:/g, '');

    try {
      const deviceDocRef = doc(db, "artifacts", appId, "devices", cleanId);
      const timestamp = Date.now();
      await setDoc(deviceDocRef, {
        ownerId: user.uid,
        apiKey: userApiKey,
        activeConfigId: defaultConfigId,
        friendlyUserId: user.displayName || "User",
        registeredAt: timestamp
      }, { merge: true });

      setActiveDeviceId(cleanId);
      setUserDevices(prev => {
        if (prev.includes(cleanId)) return prev;
        return [...prev, cleanId];
      });
      setLastSync(timestamp);
      setLinkStatus(`Success! Device ${cleanId} linked.`);
      setDeviceIdInput("");
    } catch (e) {
      setLinkStatus("Error linking device.");
    }
  };

  const handleSpotifyLogin = () => {
    if (!user || !activeDeviceId) return;
    const apiUrl = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/api`;
    window.location.href = `${apiUrl}/spotify/login?uid=${user.uid}&device_id=${activeDeviceId}&redirect=${encodeURIComponent(window.location.href)}`;
  };

  const fetchSpotifyPlayback = async () => {
    if (!user || !activeDeviceId) return;
    setLoadingSpotify(true);
    try {
      const apiUrl = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/api`;
      const response = await fetch(`${apiUrl}/spotify/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.uid,
          device_id: activeDeviceId,
          endpoint: 'me/player/currently-playing',
          method: 'GET'
        })
      });
      const result = await response.json();
      if (result.status === 'success') {
        setSpotifyPlayback(result.data);
      } else {
        console.error("Spotify API Error:", result.message);
        setSpotifyPlayback(null);
      }
    } catch (e) {
      console.error("Fetch Error:", e);
      setSpotifyPlayback(null);
    } finally {
      setLoadingSpotify(false);
    }
  };

  const fetchCalendarEvents = async () => {
    if (!user || !activeDeviceId) return;
    setLoadingCalendar(true);
    try {
      const apiUrl = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/api`;
      const response = await fetch(`${apiUrl}/calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.uid,
          device_id: activeDeviceId,
          range: integrations.calendar_range
        })
      });
      const result = await response.json();
      if (result.status === 'success') {
        setCalendarEvents(result.data);
      } else {
        console.error("Calendar API Error:", result.message);
        setCalendarEvents(null);
      }
    } catch (e) {
      console.error("Fetch Error:", e);
      setCalendarEvents(null);
    } finally {
      setLoadingCalendar(false);
    }
  };

  const fetchCanvasAssignments = async () => {
    if (!user || !activeDeviceId) return;
    setLoadingCanvas(true);
    try {
      const apiUrl = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/api`;
      const response = await fetch(`${apiUrl}/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, device_id: activeDeviceId })
      });
      const result = await response.json();
      if (result.status === 'success') {
        setCanvasAssignments(result.data);
      } else {
        console.error("Canvas API Error:", result.message);
        setCanvasAssignments(null);
      }
    } catch (e) {
      console.error("Fetch Error:", e);
      setCanvasAssignments(null);
    } finally {
      setLoadingCanvas(false);
    }
  };

  const fetchWeather = async () => {
    if (!user || !activeDeviceId) return;
    setLoadingWeather(true);
    try {
      const apiUrl = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/api`;
      const response = await fetch(`${apiUrl}/weather`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, device_id: activeDeviceId })
      });
      const result = await response.json();
      if (result.status === 'success') {
        setWeatherData(result.data);
      } else {
        console.error("Weather API Error:", result.message);
        setWeatherData(null);
      }
    } catch (e) {
      console.error("Fetch Error:", e);
      setWeatherData(null);
    } finally {
      setLoadingWeather(false);
    }
  };

  const fetchStock = async () => {
    if (!user || !activeDeviceId) return;
    setLoadingStock(true);
    try {
      const apiUrl = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/api`;
      const response = await fetch(`${apiUrl}/stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, device_id: activeDeviceId })
      });
      const result = await response.json();
      if (result.status === 'success') {
        setStockData(result.data);
      } else {
        console.error("Stock API Error:", result.message);
        setStockData(null);
      }
    } catch (e) {
      console.error("Fetch Error:", e);
      setStockData(null);
    } finally {
      setLoadingStock(false);
    }
  };

  const fetchTravel = async () => {
    if (!user || !activeDeviceId) return;
    setLoadingTravel(true);
    try {
      const apiUrl = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/api`;
      const response = await fetch(`${apiUrl}/travel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.uid,
          device_id: activeDeviceId,
          origin: integrations.travel_origin,
          destination: integrations.travel_destination,
          mode: integrations.travel_mode
        })
      });
      const result = await response.json();
      if (result.status === 'success') {
        setTravelData(result.data);
      } else {
        console.error("Travel API Error:", result.message);
        setTravelData(null);
      }
    } catch (e) {
      console.error("Fetch Error:", e);
      setTravelData(null);
    } finally {
      setLoadingTravel(false);
    }
  };

  const fetchNews = async () => {
    if (!user || !activeDeviceId) return;
    setLoadingNews(true);
    try {
      const apiUrl = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/api`;
      const response = await fetch(`${apiUrl}/news`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.uid,
          device_id: activeDeviceId,
          category: integrations.news_category
        })
      });
      const result = await response.json();
      if (result.status === 'success') {
        setNewsData(result.data);
      } else {
        console.error("News API Error:", result.message);
        setNewsData(null);
      }
    } catch (e) {
      console.error("Fetch Error:", e);
      setNewsData(null);
    } finally {
      setLoadingNews(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleAddService = (serviceId: string) => {
    setIntegrations((prev) => ({ ...prev, [`${serviceId}_enabled`]: true }));
    setIsBrowserOpen(false);
  };

  const handleRemoveService = (serviceId: string) => {
    setIntegrations((prev) => ({ ...prev, [`${serviceId}_enabled`]: false }));
  };

  const handleInputChange = (field: string, value: string) => {
    setIntegrations((prev) => ({ ...prev, [field]: value }));
  };

  // --- INTERNAL RENDER FUNCTIONS ---
  // These are defined inside InkBridge so they can access state (integrations, etc.)

  const renderDashboardPage = () => {
    const activeIntegrations: any[] = [];
    if (integrations.weather_enabled) activeIntegrations.push({ source: "weather", data: { temp: "72°F", condition: "Sunny" } });
    if (integrations.stock_enabled) activeIntegrations.push({ source: "stock", data: { symbol: integrations.stock_symbol, price: "$150.00" } });
    if (integrations.calendar_enabled) activeIntegrations.push({ source: "calendar", count: 3, next: "Meeting 10am" });
    if (integrations.canvas_enabled) activeIntegrations.push({ source: "canvas", count: 2, due: "CS101 HW" });
    if (integrations.spotify_enabled) {
      if (integrations['spotify_access_token']) {
        activeIntegrations.push({ source: "spotify", status: "Playing", track: "Never Gonna Give You Up", artist: "Rick Astley" });
      } else {
        activeIntegrations.push({ source: "spotify", status: "Not Connected" });
      }
    }
    if (integrations.travel_enabled) activeIntegrations.push({ source: "travel", data: { duration: "24 min", distance: "12 mi" } });
    if (integrations.news_enabled) activeIntegrations.push({ source: "news", data: { title: "Breaking News..." } });

    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
        <div className="mb-8 border-b border-stone-200 pb-6 text-center">
          <h1 className="text-4xl font-bold text-black">Dashboard</h1>
          <p className="text-black mt-2 text-xl font-medium">Monitor your device status and active data feeds.</p>
        </div>

        <div className="flex flex-col gap-8">
          {/* STATUS CARD */}
          <div className="bg-white text-black border border-stone-200 rounded-lg shadow-sm p-8 flex flex-col justify-between relative overflow-hidden">
            <div className="relative z-10">
              <h2 className="text-xs font-bold uppercase tracking-widest text-black mb-4 flex items-center gap-2">
                <Activity size={14} /> Device Status
              </h2>
              {activeDeviceId ? (
                <div>
                  {/* Dynamic Status Display */}
                  <div className={`text-3xl font-bold mb-2 ${deviceStatus === 'online' ? 'text-emerald-600' : 'text-amber-500'}`}>
                    {deviceStatus === 'online' ? 'Online' : 'Linked'}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {userDevices.length > 1 ? (
                      <div className="relative">
                        <select
                          value={activeDeviceId || ""}
                          onChange={(e) => setActiveDeviceId(e.target.value)}
                          className="appearance-none text-xs text-black font-mono border border-stone-200 rounded pl-2 pr-6 py-1 bg-stone-50 outline-none cursor-pointer hover:border-stone-400 transition-colors"
                        >
                          {userDevices.map(id => (
                            <option key={id} value={id}>{id}</option>
                          ))}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1 text-stone-500">
                          <ChevronDown size={12} />
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-black font-mono border border-stone-200 rounded p-1 inline-block">
                        ID: {activeDeviceId}
                      </div>
                    )}
                    {deviceStatus === 'linked' && (
                       <span className="text-[10px] text-stone-400 italic">Waiting for connection...</span>
                    )}
                  </div>

                  {lastSync && deviceStatus === 'online' && (
                    <div className="text-[10px] text-black mt-4 font-mono">
                      Last Contact: {new Date(lastSync).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              ) : (
                // ... existing "No Device" state ...
                <div>
                  <div className="text-2xl text-stone-500 mb-1">No Device</div>
                  <div className="text-xs text-stone-500">Link a device in Setup</div>
                </div>
              )}
            </div>
          </div>

          {/* PIPELINE CARD */}
          <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-8">
            <h2 className="text-xs font-bold uppercase tracking-widest text-black mb-4 flex items-center gap-2"><Server size={14} /> Active Data Pipeline</h2>
            {activeIntegrations.length === 0 ? (
              <div className="text-center py-8 text-stone-400 text-sm border-2 border-dashed border-stone-100 rounded-lg">
                No data sources enabled. Go to <button onClick={() => setCurrentView('integrations')} className="text-black underline font-bold decoration-stone-300 underline-offset-4">Integrations</button> to configure.
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {activeIntegrations.map((item, i) => (
                  <div key={`${item.source}-${i}`} className="px-4 py-2 bg-stone-50 border border-stone-200 rounded-md text-sm text-black flex items-center gap-2 font-medium">
                    <div className="w-2 h-2 rounded-full bg-stone-900 animate-pulse"></div>
                    <span className="capitalize">{item.source}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSetupPage = () => {
    const apiUrl = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/api`;
    return (
      <div className="animate-in fade-in slide-in-from-bottom-4">
        <div className="mb-8 border-b border-stone-200 pb-6 text-center">
          <h1 className="text-4xl font-bold text-black">Device Setup</h1>
          <p className="text-black mt-2 text-xl font-medium">Connect your hardware to the InkBridge cloud.</p>
        </div>

        <div className="flex flex-col gap-8">
          <div className="space-y-6">
            {/* Device Linking Card */}
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-8">
              <h2 className="text-xs font-bold uppercase tracking-widest text-black mb-6 flex items-center gap-2"><Wifi size={16} /> Device Handshake</h2>
              <p className="text-[13px] text-black mb-3">Enter the Device ID displayed on your ESP32 screen.</p>
              <div className="flex gap-2 mb-2">
                <input
                  value={deviceIdInput}
                  onChange={(e) => setDeviceIdInput(e.target.value)}
                  placeholder="E.g. 9C9E6E52FC28"
                  className="flex-1 bg-stone-50 border border-stone-200 rounded-md px-3 py-2 text-sm text-black focus:ring-1 focus:ring-black outline-none font-mono uppercase placeholder:text-stone-400"
                />
                <button onClick={registerDevice} className="bg-stone-900 hover:bg-black text-white px-4 rounded-md font-bold transition-colors shadow-sm"><Check size={16} /></button>
              </div>
              {linkStatus && <p className={`text-[11px] font-medium mt-2 font-mono ${linkStatus.includes("Success") ? "text-emerald-700" : "text-red-600"}`}>{linkStatus}</p>}
              {activeDeviceId && (
                <div className="mt-4 p-3 bg-stone-50 border border-stone-200 rounded-md text-xs text-black flex items-center gap-2">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                  Active Device: <span className="font-mono font-bold text-black">{activeDeviceId}</span>
                </div>
              )}
            </div>

            {/* Credentials */}
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-8">
              <h2 className="text-xs font-bold uppercase tracking-widest text-black mb-6 flex items-center gap-2"><Key size={16} /> Access Keys</h2>

              <div className="mb-5">
                <label className="block text-[10px] text-black mb-1 font-bold uppercase">User ID</label>
                <div className="flex gap-2 group cursor-pointer" onClick={() => copyToClipboard(user?.uid || "")}>
                  <code className="flex-1 bg-stone-50 border border-stone-200 rounded px-3 py-2 text-[11px] font-mono text-black truncate group-hover:bg-stone-100 transition-colors">{user?.uid}</code>
                  <button className="p-1.5 bg-white border border-stone-200 rounded text-stone-400 hover:text-stone-900 hover:bg-stone-50"><Copy size={14} /></button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-black mb-1 font-bold uppercase">API Secret</label>
                <div className="flex gap-2 group">
                  <div className="flex-1 bg-stone-50 border border-stone-200 rounded px-3 py-2 text-[11px] font-mono text-black truncate relative overflow-hidden">
                    {showInkKey ? userApiKey : "•".repeat(32)}
                  </div>
                  <button onClick={() => setShowInkKey(!showInkKey)} className="p-1.5 bg-white border border-stone-200 rounded text-stone-400 hover:text-stone-900 hover:bg-stone-50">{showInkKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  <button onClick={() => copyToClipboard(userApiKey)} className="p-1.5 bg-white border border-stone-200 rounded text-stone-400 hover:text-stone-900 hover:bg-stone-50"><Copy size={14} /></button>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {/* API Info */}
            <div className="bg-stone-100 rounded-lg border border-stone-200 p-8">
              <h3 className="text-black text-xs font-bold mb-3 flex items-center gap-2 uppercase tracking-wider"><Server size={14} /> API Endpoint</h3>
              <div className="flex gap-2">
                <code className="flex-1 bg-white p-3 rounded text-[11px] font-mono text-black break-all border border-stone-200">{apiUrl}</code>
                <button onClick={() => copyToClipboard(apiUrl)} className="p-2 bg-white rounded text-stone-400 hover:text-stone-900 border border-stone-200 hover:bg-stone-50 self-start"><Copy size={14} /></button>
              </div>
            </div>

            {/* Firmware Snippet */}
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-0 overflow-hidden">
              <div className="bg-stone-50 border-b border-stone-200 p-3">
                <h3 className="text-xs font-bold text-black uppercase tracking-widest flex items-center gap-2"><Cpu size={14} /> Firmware Logic</h3>
              </div>
              <div className="bg-[#1e1e1e] p-4 overflow-x-auto">
                <pre className="text-[11px] text-stone-300 font-mono leading-relaxed">{`// InkBridge ESP32 Logic
void setup() {
  // 1. Connect WiFi
  // 2. HTTP GET /setup?device_id=MAC
  // 3. Save received API Key
}

void loop() {
  // 1. HTTP GET /data?device_id=MAC
  // 2. Parse JSON & Render
  // 3. Deep Sleep
}`}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderServiceBrowser = () => {
    if (!isBrowserOpen) return null;

    // Filter services that are NOT yet enabled
    const available = AVAILABLE_SERVICES.filter(s => !integrations[`${s.id}_enabled`]);

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-stone-900/60 backdrop-blur-sm animate-in fade-in">
        <div className="bg-white rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl relative border border-stone-200">
          <button onClick={() => setIsBrowserOpen(false)} className="absolute top-4 right-4 text-stone-400 hover:text-stone-900 p-1 rounded-full hover:bg-stone-100 transition-colors">
            <X size={20} />
          </button>

          <div className="p-6 border-b border-stone-100">
            <h2 className="text-2xl font-bold text-black mb-1">Add Integration</h2>
            <p className="text-sm text-black italic">Choose a service to add to your dashboard pipeline.</p>
          </div>

          <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4 bg-stone-50/30 rounded-b-lg">
            {available.length === 0 ? (
              <div className="col-span-2 text-center py-10 text-stone-400 italic">
                All available services are already enabled.
              </div>
            ) : (
              available.map((service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  onAdd={() => handleAddService(service.id)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderIntegrationsPage = () => {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
        <div className="mb-8 border-b border-stone-200 pb-6 text-center">
          <h1 className="text-4xl font-bold text-black">Integrations</h1>
          <p className="text-black mt-2 text-xl font-medium">Manage connected services and APIs.</p>
        </div>

        <div className="flex justify-end gap-3 mb-6">
          <button
            onClick={() => setIsBrowserOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full font-bold bg-white text-black hover:bg-stone-50 transition-all text-sm border border-stone-300 shadow-sm hover:shadow"
          >
            <Plus size={16} /> Add Service
          </button>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold transition-all text-xs ${saveState === 'saved' ? 'text-emerald-600 bg-emerald-50 border border-emerald-100' : saveState === 'saving' ? 'text-stone-500 bg-stone-100' : 'text-stone-400 bg-stone-50 border border-stone-100'}`}>
            {saveState === 'saving' && <RefreshCw size={12} className="animate-spin" />}
            {(saveState === 'saved' || saveState === 'idle') && <Check size={12} />}
            {saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved' : 'No Changes'}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          {integrations.weather_enabled && (
            <ActiveIntegrationCard
              serviceId="weather"
              isEnabled={integrations.weather_enabled as boolean}
              onRemove={() => handleRemoveService('weather')}
            >
              <InputField label="Location" value={integrations.weather_city as string} field="weather_city" onChange={handleInputChange} placeholder="e.g. Denver, London" subtext="Uses WeatherAPI.com." />
              <InputField label="API Key (Optional)" value={integrations.weather_api_key as string} field="weather_api_key" onChange={handleInputChange} placeholder="Uses system default if empty" type="password" />
              
              <div className="mt-4 pt-4 border-t border-stone-100">
                 <div className="flex items-center gap-3 mb-3">
                    <button 
                      onClick={fetchWeather} 
                      disabled={loadingWeather}
                      className="bg-stone-900 hover:bg-black text-white px-4 py-2 rounded-md text-xs font-bold transition-colors flex items-center gap-2 shadow-sm"
                    >
                      {loadingWeather ? <RefreshCw size={14} className="animate-spin"/> : <Cloud size={14} />}
                      Check Weather
                    </button>
                 </div>
                 {weatherData && (
                   <div className="text-xs text-black bg-stone-50 border border-stone-200 px-3 py-2 rounded-md shadow-sm">
                     <div className="font-bold">{weatherData.city}</div>
                     <div className="text-[10px] text-stone-500 mt-1">{weatherData.temp}°F - {weatherData.condition} ({weatherData.description})</div>
                   </div>
                 )}
              </div>
            </ActiveIntegrationCard>
          )}

          {integrations.stock_enabled && (
            <ActiveIntegrationCard
              serviceId="stock"
              isEnabled={integrations.stock_enabled as boolean}
              onRemove={() => handleRemoveService('stock')}
            >
              <InputField label="Stock Symbol" value={integrations.stock_symbol as string} field="stock_symbol" onChange={handleInputChange} placeholder="e.g. AAPL" subtext="Displays price and trend." />
              <InputField label="Finnhub API Key (Optional)" value={integrations.stock_api_key as string} field="stock_api_key" onChange={handleInputChange} placeholder="Uses system default if empty" type="password" />
              
              <div className="mt-4 pt-4 border-t border-stone-100">
                 <div className="flex items-center gap-3 mb-3">
                    <button 
                      onClick={fetchStock} 
                      disabled={loadingStock}
                      className="bg-stone-900 hover:bg-black text-white px-4 py-2 rounded-md text-xs font-bold transition-colors flex items-center gap-2 shadow-sm"
                    >
                      {loadingStock ? <RefreshCw size={14} className="animate-spin"/> : <TrendingUp size={14} />}
                      Check Stock
                    </button>
                 </div>
                 {stockData && (
                   <div className="text-xs text-black bg-stone-50 border border-stone-200 px-3 py-2 rounded-md shadow-sm">
                     <div className="font-bold">{stockData.symbol}</div>
                     <div className="text-[10px] text-stone-500 mt-1">${stockData.price} ({stockData.percent > 0 ? '+' : ''}{stockData.percent}%)</div>
                   </div>
                 )}
              </div>
            </ActiveIntegrationCard>
          )}

          {integrations.calendar_enabled && (
            <ActiveIntegrationCard
              serviceId="calendar"
              isEnabled={integrations.calendar_enabled as boolean}
              onRemove={() => handleRemoveService('calendar')}
            >
              <InputField label="iCal URL" value={integrations.ical_url as string} field="ical_url" onChange={handleInputChange} placeholder="https://calendar.google.com/..." subtext="Google Calendar > Settings > Public/Secret address in iCal format." />
              <ToggleGroup 
                label="Date Range" 
                value={integrations.calendar_range || "1d"} 
                field="calendar_range" 
                onChange={handleInputChange} 
                options={[
                  { value: "1d", label: "1 Day" },
                  { value: "3d", label: "3 Days" },
                  { value: "1w", label: "1 Week" },
                  { value: "1m", label: "1 Month" }
                ]}
                subtext="How far ahead to look for events."
              />
              
              <div className="mt-4 pt-4 border-t border-stone-100">
                 <div className="flex items-center gap-3 mb-3">
                    <button 
                      onClick={fetchCalendarEvents} 
                      disabled={loadingCalendar}
                      className="bg-stone-900 hover:bg-black text-white px-4 py-2 rounded-md text-xs font-bold transition-colors flex items-center gap-2 shadow-sm"
                    >
                      {loadingCalendar ? <RefreshCw size={14} className="animate-spin"/> : <Calendar size={14} />}
                      Check Events
                    </button>
                 </div>
                 {calendarEvents && (
                   <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                     {calendarEvents.length > 0 ? (
                       calendarEvents.map((evt: any, idx: number) => (
                         <div key={idx} className="text-xs text-black bg-stone-50 border border-stone-200 px-3 py-2 rounded-md shadow-sm">
                           <div className="font-bold truncate">{evt.summary}</div>
                           <div className="text-[10px] text-stone-500 flex justify-between mt-1">
                             <span>{new Date(evt.start).toLocaleDateString()} {new Date(evt.start).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                           </div>
                         </div>
                       ))
                     ) : (
                       <div className="text-xs text-stone-500 italic bg-stone-50 border border-stone-200 px-3 py-2 rounded-md">
                         No events found.
                       </div>
                     )}
                   </div>
                 )}
              </div>
            </ActiveIntegrationCard>
          )}

          {integrations.canvas_enabled && (
            <ActiveIntegrationCard
              serviceId="canvas"
              isEnabled={integrations.canvas_enabled as boolean}
              onRemove={() => handleRemoveService('canvas')}
            >
              <InputField label="Canvas Domain" value={integrations.canvas_domain as string} field="canvas_domain" onChange={handleInputChange} placeholder="canvas.instructure.com" subtext="Your school's Canvas URL." />
              <InputField label="Access Token" value={integrations.canvas_token as string} field="canvas_token" onChange={handleInputChange} placeholder="7~..." type="password" subtext="Canvas > Account > Settings > New Access Token." />
              
              <div className="mt-4 pt-4 border-t border-stone-100">
                 <div className="flex items-center gap-3 mb-3">
                    <button 
                      onClick={fetchCanvasAssignments} 
                      disabled={loadingCanvas}
                      className="bg-stone-900 hover:bg-black text-white px-4 py-2 rounded-md text-xs font-bold transition-colors flex items-center gap-2 shadow-sm"
                    >
                      {loadingCanvas ? <RefreshCw size={14} className="animate-spin"/> : <BookOpen size={14} />}
                      Check Assignments
                    </button>
                 </div>
                 {canvasAssignments && (
                   <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                     {canvasAssignments.length > 0 ? (
                       canvasAssignments.map((item: any, idx: number) => (
                         <div key={idx} className="text-xs text-black bg-stone-50 border border-stone-200 px-3 py-2 rounded-md shadow-sm">
                           <div className="font-bold truncate">{item.title}</div>
                           <div className="text-[10px] text-stone-500 flex justify-between mt-1">
                             <span>{item.due_at ? new Date(item.due_at).toLocaleDateString() : 'No Due Date'}</span>
                             <span className="capitalize">{item.type}</span>
                           </div>
                         </div>
                       ))
                     ) : (
                       <div className="text-xs text-stone-500 italic bg-stone-50 border border-stone-200 px-3 py-2 rounded-md">
                         No assignments found.
                       </div>
                     )}
                   </div>
                 )}
              </div>
            </ActiveIntegrationCard>
          )}

          {integrations.spotify_enabled && (
            <ActiveIntegrationCard
              serviceId="spotify"
              isEnabled={integrations.spotify_enabled as boolean}
              onRemove={() => handleRemoveService('spotify')}
            >
              <div className="flex flex-col gap-4 border border-dashed border-stone-200 p-4 rounded-lg bg-stone-50">
                <p className="text-xs text-stone-500 italic">Connect your Spotify account to display playback info.</p>
                {integrations['spotify_access_token'] ? (
                  <div className="space-y-3">
                    <button disabled className="self-start bg-emerald-100 text-emerald-700 font-bold py-2 px-6 rounded-full text-xs flex items-center gap-2 shadow-sm border border-emerald-200 cursor-default">
                      <Check size={16} /> Spotify Connected
                    </button>
                    
                    <div className="flex items-center gap-3">
                       <button 
                         onClick={fetchSpotifyPlayback} 
                         disabled={loadingSpotify}
                         className="bg-stone-900 hover:bg-black text-white px-4 py-2 rounded-md text-xs font-bold transition-colors flex items-center gap-2 shadow-sm"
                       >
                         {loadingSpotify ? <RefreshCw size={14} className="animate-spin"/> : <Music size={14} />}
                         Check Now
                       </button>
                       {spotifyPlayback && (
                         <div className="text-xs text-black bg-white border border-stone-200 px-3 py-2 rounded-md shadow-sm">
                           {spotifyPlayback.item ? (
                             <span>
                               <strong>{spotifyPlayback.item.name}</strong> by {spotifyPlayback.item.artists.map((a: any) => a.name).join(', ')}
                             </span>
                           ) : (
                             <span className="text-stone-500 italic">Nothing playing</span>
                           )}
                         </div>
                       )}
                    </div>
                  </div>
                ) : (
                  <button onClick={handleSpotifyLogin} className="self-start bg-[#1DB954] hover:bg-[#1ed760] text-white font-bold py-2 px-6 rounded-full text-xs transition-colors flex items-center gap-2 shadow-sm">
                    <Music size={16} /> Connect Spotify
                  </button>
                )}
              </div>
            </ActiveIntegrationCard>
          )}

          {integrations.travel_enabled && (
            <ActiveIntegrationCard
              serviceId="travel"
              isEnabled={integrations.travel_enabled as boolean}
              onRemove={() => handleRemoveService('travel')}
            >
              <InputField label="Origin" value={integrations.travel_origin as string} field="travel_origin" onChange={handleInputChange} placeholder="e.g. 123 Home St, Denver CO" />
              <InputField label="Destination" value={integrations.travel_destination as string} field="travel_destination" onChange={handleInputChange} placeholder="e.g. Work Office" />
              <ToggleGroup 
                label="Mode" 
                value={integrations.travel_mode as string} 
                field="travel_mode" 
                onChange={handleInputChange} 
                options={[
                  { value: "driving", label: "Driving" },
                  { value: "transit", label: "Transit" },
                  { value: "walking", label: "Walking" },
                  { value: "bicycling", label: "Bike" }
                ]}
              />
              <InputField label="Google Maps API Key (Optional)" value={integrations.travel_api_key as string} field="travel_api_key" onChange={handleInputChange} placeholder="Uses system default if empty" type="password" />
              
              <div className="mt-4 pt-4 border-t border-stone-100">
                 <div className="flex items-center gap-3 mb-3">
                    <button 
                      onClick={fetchTravel} 
                      disabled={loadingTravel}
                      className="bg-stone-900 hover:bg-black text-white px-4 py-2 rounded-md text-xs font-bold transition-colors flex items-center gap-2 shadow-sm"
                    >
                      {loadingTravel ? <RefreshCw size={14} className="animate-spin"/> : <MapPin size={14} />}
                      Check Commute
                    </button>
                 </div>
                 {travelData && (
                   <div className="text-xs text-black bg-stone-50 border border-stone-200 px-3 py-2 rounded-md shadow-sm">
                     <div className="font-bold">{travelData.duration}</div>
                     <div className="text-[10px] text-stone-500 mt-1">{travelData.distance} to {travelData.destination}</div>
                   </div>
                 )}
              </div>
            </ActiveIntegrationCard>
          )}

          {integrations.news_enabled && (
            <ActiveIntegrationCard
              serviceId="news"
              isEnabled={integrations.news_enabled as boolean}
              onRemove={() => handleRemoveService('news')}
            >
              <ToggleGroup 
                label="Category" 
                value={integrations.news_category as string} 
                field="news_category" 
                onChange={handleInputChange} 
                options={[
                  { value: "general", label: "General" },
                  { value: "technology", label: "Tech" },
                  { value: "business", label: "Business" },
                  { value: "science", label: "Science" }
                ]}
              />
              <InputField label="NewsAPI Key (Optional)" value={integrations.news_api_key as string} field="news_api_key" onChange={handleInputChange} placeholder="Uses system default if empty" type="password" />
              
              <div className="mt-4 pt-4 border-t border-stone-100">
                 <div className="flex items-center gap-3 mb-3">
                    <button 
                      onClick={fetchNews} 
                      disabled={loadingNews}
                      className="bg-stone-900 hover:bg-black text-white px-4 py-2 rounded-md text-xs font-bold transition-colors flex items-center gap-2 shadow-sm"
                    >
                      {loadingNews ? <RefreshCw size={14} className="animate-spin"/> : <Newspaper size={14} />}
                      Check News
                    </button>
                 </div>
                 {newsData && newsData.length > 0 && (
                   <div className="text-xs text-black bg-stone-50 border border-stone-200 px-3 py-2 rounded-md shadow-sm">
                     <div className="font-bold truncate">{newsData[0].title}</div>
                     <div className="text-[10px] text-stone-500 mt-1">{newsData[0].source}</div>
                   </div>
                 )}
              </div>
            </ActiveIntegrationCard>
          )}

          {/* Empty State */}
          {!integrations.weather_enabled && !integrations.stock_enabled && !integrations.calendar_enabled && !integrations.canvas_enabled && !integrations.spotify_enabled && !integrations.travel_enabled && !integrations.news_enabled && (
            <div className="md:col-span-2 py-16 border-2 border-dashed border-stone-200 rounded-lg flex flex-col items-center justify-center text-black bg-stone-50/50">
              <Settings size={32} className="mb-3 opacity-20" />
              <p className="italic text-lg text-black">No services enabled.</p>
              <p className="text-xs mt-1">Click "Add Service" to start configuring your dashboard.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // --- MAIN RENDER ---

  if (loading) return <div className="h-screen bg-white flex items-center justify-center text-stone-400 italic" style={{ fontFamily: '"Segoe UI", sans-serif' }}>Loading InkBridge...</div>;

  return (
    <div className="min-h-screen bg-white text-black selection:bg-stone-200 selection:text-black" style={{ fontFamily: '"Segoe UI", sans-serif' }}>
      {renderServiceBrowser()}

      {/* HEADER */}
      <header className={`bg-white sticky top-0 z-50 transition-all duration-200 ${scrolled ? 'border-b border-stone-200' : ''}`}>
        <div className="w-full px-6 h-16 flex items-center justify-between relative">
          <div className="flex items-center gap-8">
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2 text-black"><LayoutDashboard size={20} className="text-black" /> InkBridge</h1>
          </div>

          {/* NAVIGATION TABS */}
          {user && (
            <div className="hidden md:flex gap-2 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <NavButton active={currentView === 'dashboard'} onClick={() => setCurrentView('dashboard')} icon={Home} label="Dashboard" />
              <NavButton active={currentView === 'integrations'} onClick={() => setCurrentView('integrations')} icon={Sliders} label="Integrations" />
              <NavButton active={currentView === 'setup'} onClick={() => setCurrentView('setup')} icon={Smartphone} label="Setup" />
            </div>
          )}

          {user ? (
            <div className="flex items-center gap-4">
              {user.photoURL ? (
                <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center text-stone-500">
                  <UserIcon size={16} />
                </div>
              )}
              <button onClick={handleLogout} className="text-sm text-black hover:bg-stone-100 px-3 py-1.5 rounded transition-colors font-medium">Sign Out</button>
            </div>
          ) : (
            <button onClick={handleLogin} className="flex items-center gap-2 bg-stone-900 hover:bg-black px-5 py-2 rounded-full text-sm font-bold transition-all text-white shadow-md"><UserIcon size={16} /> Sign In</button>
          )}
        </div>

        {/* Mobile Nav */}
        {user && (
          <div className="md:hidden flex justify-center gap-2 pb-3 border-t border-stone-100 pt-3 bg-white">
            <NavButton active={currentView === 'dashboard'} onClick={() => setCurrentView('dashboard')} icon={Home} label="Dash" />
            <NavButton active={currentView === 'integrations'} onClick={() => setCurrentView('integrations')} icon={Sliders} label="Integrations" />
            <NavButton active={currentView === 'setup'} onClick={() => setCurrentView('setup')} icon={Smartphone} label="Setup" />
          </div>
        )}
      </header>

      {/* CONTENT */}
      <main className="max-w-6xl mx-auto px-6 py-10">
        {!user ? (
          <div className="text-center py-20">
            <h2 className="text-5xl font-bold text-black mb-6">Configure Your <br />InkBridge Display</h2>
            <p className="text-black max-w-md mx-auto mb-10 text-lg italic">Connect your ESP32 E-Ink display and configure your data sources in a unified, paper-like interface.</p>
            <button onClick={handleLogin} className="bg-stone-900 hover:bg-black text-white px-8 py-4 rounded-full font-bold text-lg transition-all shadow-xl hover:translate-y-[-2px]">Get Started</button>
          </div>
        ) : (
          <>
            {/* VIEWS */}
            {currentView === 'dashboard' && renderDashboardPage()}
            {currentView === 'setup' && renderSetupPage()}
            {currentView === 'integrations' && renderIntegrationsPage()}
          </>
        )}
      </main>
    </div>
  );
}