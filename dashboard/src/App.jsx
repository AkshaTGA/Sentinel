import React, { useState, useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { 
  authAPI, 
  devicesAPI, 
  commandsAPI,
  WS_BASE_URL,
  API_BASE_URL
} from './api';
import { 
  Monitor, 
  Cpu, 
  HardDrive, 
  Battery, 
  Clock, 
  MapPin, 
  Lock, 
  Camera, 
  Image as ImageIcon, 
  Terminal, 
  Bell, 
  LogOut, 
  Plus, 
  RefreshCw, 
  Play, 
  Volume2, 
  Power, 
  AlertTriangle,
  User,
  X,
  Menu,
  Copy,
  Check,
  Trash2,
  Folder,
  Activity,
  Clipboard,
  FileText,
  ChevronRight,
  ChevronDown,
  Search,
  Download,
  Timer,
  RotateCcw,
  Wifi
} from 'lucide-react';


// Lazy loaded components
const LocationMap = React.lazy(() => import('./components/LocationMap'));

const parseTerminalText = (currentBuffer, newChunk) => {
  let buf = currentBuffer;
  
  // 1. Strip OSC (Operating System Command) sequences (e.g. \x1b]0;title\x07)
  newChunk = newChunk.replace(/(\x1b|\u001b)\][^\x07\u0007]*?(\x07|\u0007)/g, '');
  
  // 2. Normalize line endings (\r\n -> \n, strip stray \r)
  newChunk = newChunk.replace(/\r\n/g, '\n');
  newChunk = newChunk.replace(/\r/g, '');
  
  // 3. Handle clear screen sequences
  if (newChunk.includes('\u001b[2J') || newChunk.includes('\u001b[H') || newChunk.includes('\x1b[2J') || newChunk.includes('\x1b[H')) {
    buf = '';
    newChunk = newChunk.replace(/\u001b\[2J/g, '').replace(/\u001b\[H/g, '').replace(/\x1b\[2J/g, '').replace(/\x1b\[H/g, '');
  }
  
  let i = 0;
  while (i < newChunk.length) {
    const char = newChunk[i];
    
    if (char === '\b' || char === '\x7f' || char === '\x08') {
      if (buf.length > 0) {
        buf = buf.slice(0, -1);
      }
    } else if (char === '\u001b' || char === '\x1b') {
      let j = i + 1;
      if (j < newChunk.length) {
        if (newChunk[j] === '[') {
          // CSI sequence: skip until letter
          j++;
          while (j < newChunk.length) {
            const code = newChunk.charCodeAt(j);
            if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
              break;
            }
            j++;
          }
        } else if (newChunk[j] === '(' || newChunk[j] === ')') {
          // Character set escape sequence (e.g. \x1b(B): skip 2 chars
          j += 1;
        }
      }
      i = j;
    } else {
      buf += char;
    }
    i++;
  }
  return buf;
};

function App() {
  return (
    <HashRouter>
      <MainAppContent />
    </HashRouter>
  );
}

function CollapsibleCard({ 
  title, 
  subtitle, 
  icon: Icon, 
  children, 
  defaultOpen = true, 
  className = "", 
  style = {}, 
  headerStyle = {}, 
  contentStyle = {},
  isOnlineBadge = null, 
  headerActions = null 
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div className={`section-card ${className}`} style={{ ...style, marginBottom: '20px' }}>
      <div 
        className="section-header" 
        style={{ 
          cursor: 'pointer', 
          userSelect: 'none', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          transition: 'background 0.2s',
          ...headerStyle 
        }}
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isOpen ? <ChevronDown size={18} style={{ color: 'var(--color-accent)' }} /> : <ChevronRight size={18} style={{ color: 'var(--text-muted)' }} />}
          {Icon && <Icon size={18} />}
          <span>{title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }} onClick={(e) => e.stopPropagation()}>
          {subtitle && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{subtitle}</span>}
          {isOnlineBadge}
          {headerActions}
        </div>
      </div>
      
      {isOpen && (
        <div className="section-content" style={contentStyle}>
          {children}
        </div>
      )}
    </div>
  );
}

function MainAppContent() {
  // Authentication State
  const [user, setUser] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [authMode, setAuthMode] = useState('login'); // login | register
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Dashboard Data State
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [telemetry, setTelemetry] = useState([]);
  const [commands, setCommands] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');

  // Modal & Prompt States
  const [isRegModalOpen, setIsRegModalOpen] = useState(false);
  const [regMethod, setRegMethod] = useState('auto'); // auto | step
  const [copiedStep, setCopiedStep] = useState(null);
  const [isMsgModalOpen, setIsMsgModalOpen] = useState(false);
  const [customMsg, setCustomMsg] = useState('');
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [confirmCmdType, setConfirmCmdType] = useState(''); // SHUTDOWN | RESTART
  const [copiedId, setCopiedId] = useState(false);
  const [isUnregisterModalOpen, setIsUnregisterModalOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Interactive Operations State
  const [activeTab, setActiveTab] = useState('terminal'); // terminal | files | processes | clipboard
  
  // Terminal Tab State
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalOutputs, setTerminalOutputs] = useState([]);
  const [terminalRunning, setTerminalRunning] = useState(false);
  
  // File Manager Tab State
  const [currentPath, setCurrentPath] = useState('~');
  const [fileItems, setFileItems] = useState([]);
  const [fileLoading, setFileLoading] = useState(false);
  const [viewedFileContent, setViewedFileContent] = useState(null); // String or null (modal)
  const [viewedFileName, setViewedFileName] = useState('');
  const [downloadingItemName, setDownloadingItemName] = useState(null);
  
  // Processes Tab State
  const [processList, setProcessList] = useState([]);
  const [processLoading, setProcessLoading] = useState(false);
  const [processSearch, setProcessSearch] = useState('');
  
  // Clipboard Tab State
  const [remoteClipboard, setRemoteClipboard] = useState('');
  const [clipboardLoading, setClipboardLoading] = useState(false);
  const [newClipboardVal, setNewClipboardVal] = useState('');

  // Live Camera Streaming & Microphone Recording & USB Monitoring States
  const [liveCameraFrame, setLiveCameraFrame] = useState(null);
  const [isStreamingLive, setIsStreamingLive] = useState(false);
  const [liveScreenFrame, setLiveScreenFrame] = useState(null);
  const [isStreamingScreen, setIsStreamingScreen] = useState(false);
  const [audioDuration, setAudioDuration] = useState(10);
  const [audioRecordingLoading, setAudioRecordingLoading] = useState(false);
  const [usbDevices, setUsbDevices] = useState([]);
  const liveStreamSocketRef = useRef(null);
  const liveScreenSocketRef = useRef(null);

  // Auto-capture States
  const [isAutoScreenshot, setIsAutoScreenshot] = useState(false);
  const [autoScreenshotInterval, setAutoScreenshotInterval] = useState(60);
  const [isAutoWebcam, setIsAutoWebcam] = useState(false);
  const [autoWebcamInterval, setAutoWebcamInterval] = useState(60);
  const [restartingShell, setRestartingShell] = useState(false);
  const [shellKey, setShellKey] = useState(0); // incrementing forces terminal WS reconnect

  // Dynamic status & polling states
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('OFFLINE'); // ONLINE_WS | ONLINE_HTTP | OFFLINE
  const [pollingIntervalInput, setPollingIntervalInput] = useState(60);

  // Poll intervals
  const pollTimerRef = useRef(null);
  const terminalInputRef = useRef(null);
  const terminalEndRef = useRef(null);
  const terminalSocketRef = useRef(null);
  const hiddenTerminalInputRef = useRef(null);

  // Dispatches a command and polls for response
  const dispatchAndWait = async (type, payload, maxAttempts = 90) => {
    if (!selectedDevice) throw new Error('No device selected');
    const cmd = await commandsAPI.dispatch(selectedDevice.id, type, payload);
    
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        try {
          const res = await devicesAPI.getCommands(selectedDevice.id, 10);
          const updatedCmd = res.find(c => c.id === cmd.id);
          if (updatedCmd) {
            if (updatedCmd.status === 'EXECUTED') {
              clearInterval(interval);
              resolve(updatedCmd.result_url || '');
            } else if (updatedCmd.status === 'FAILED') {
              clearInterval(interval);
              reject(new Error(updatedCmd.error_message || 'Command execution failed'));
            }
          }
        } catch (err) {
          console.error(err);
        }
        if (attempts > maxAttempts) {
          clearInterval(interval);
          reject(new Error('Command execution timed out'));
        }
      }, 1000);
    });
  };

  // Check login state on mount
  useEffect(() => {
    const token = localStorage.getItem('sentinel_token');
    if (token) {
      fetchUser();
    }
  }, []);

  // Redirect unauthenticated users to /login
  useEffect(() => {
    const token = localStorage.getItem('sentinel_token');
    if (!token && location.pathname !== '/login') {
      navigate('/login', { replace: true });
    } else if (token && location.pathname === '/login' && user) {
      if (selectedDevice) {
        navigate(`/device/${selectedDevice.id}/telemetry`, { replace: true });
      } else if (devices.length > 0) {
        navigate(`/device/${devices[0].id}/telemetry`, { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    }
  }, [user, location.pathname, devices, selectedDevice]);

  // Synchronize route deviceId with selectedDevice state
  useEffect(() => {
    if (!user) return;
    const match = location.pathname.match(/\/device\/([^/]+)/);
    const routeDeviceId = match ? match[1] : null;

    if (routeDeviceId) {
      if (!selectedDevice || selectedDevice.id !== routeDeviceId) {
        const found = devices.find(d => d.id === routeDeviceId);
        if (found) {
          setSelectedDevice(found);
        }
      }
    } else {
      if (location.pathname === '/' && devices.length > 0) {
        navigate(`/device/${devices[0].id}/telemetry`, { replace: true });
      }
    }
  }, [location.pathname, devices, user]);

  // Poll active device telemetry and command logs every 5 seconds
  useEffect(() => {
    if (selectedDevice) {
      fetchDeviceData(selectedDevice.id);

      // Load persisted auto-capture states from localStorage
      const activeSS = localStorage.getItem(`auto_screenshot_active_${selectedDevice.id}`) === 'true';
      const intervalSS = Number(localStorage.getItem(`auto_screenshot_interval_${selectedDevice.id}`)) || 60;
      const activeWC = localStorage.getItem(`auto_webcam_active_${selectedDevice.id}`) === 'true';
      const intervalWC = Number(localStorage.getItem(`auto_webcam_interval_${selectedDevice.id}`)) || 60;

      setIsAutoScreenshot(activeSS);
      setAutoScreenshotInterval(intervalSS);
      setIsAutoWebcam(activeWC);
      setAutoWebcamInterval(intervalWC);
      
      // Clear existing interval
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
      
      // Start new polling interval
      pollTimerRef.current = setInterval(() => {
        pollDeviceData(selectedDevice.id);
      }, 5000);
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setTelemetry([]);
      setCommands([]);
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [selectedDevice?.id]);

  // Auth Functions
  const fetchUser = async () => {
    try {
      const data = await authAPI.getMe();
      setUser(data);
      fetchDevices();
    } catch (err) {
      handleLogout();
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      await authAPI.login(email, password);
      await fetchUser();
    } catch (err) {
      setAuthError(err.response?.data?.detail || 'Authentication failed. Check credentials.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      await authAPI.register(email, password);
      setAuthMode('login');
      setAuthError('Registration successful. Please log in.');
    } catch (err) {
      setAuthError(err.response?.data?.detail || 'Registration failed. Try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    authAPI.logout();
    setUser(null);
    setDevices([]);
    setSelectedDevice(null);
  };

  // Device & Telemetry Data Fetchers
  const fetchDevices = async () => {
    try {
      const data = await devicesAPI.list();
      setDevices(data);
      
      // Auto select first device if none selected
      if (data.length > 0 && !selectedDevice) {
        setSelectedDevice(data[0]);
      }
    } catch (err) {
      setDashboardError('Failed to fetch devices list.');
    }
  };

  const fetchDeviceData = async (deviceId) => {
    setLoading(true);
    try {
      const [telData, cmdData] = await Promise.all([
        devicesAPI.getTelemetry(deviceId, 30),
        devicesAPI.getCommands(deviceId, 30)
      ]);
      setTelemetry(telData);
      setCommands(cmdData);
    } catch (err) {
      setDashboardError('Failed to fetch device logs.');
    } finally {
      setLoading(false);
    }
  };

  const pollDeviceData = async (deviceId) => {
    try {
      const [telData, cmdData, devicesList] = await Promise.all([
        devicesAPI.getTelemetry(deviceId, 30),
        devicesAPI.getCommands(deviceId, 30),
        devicesAPI.list()
      ]);
      setTelemetry(telData);
      setCommands(cmdData);
      setDevices(devicesList);
      
      // Update selected device status from list
      const updated = devicesList.find(d => d.id === deviceId);
      if (updated) {
        setSelectedDevice(updated);
      }
    } catch (err) {
      console.warn('Polling logs failed');
    }
  };

  // Handle connection status and countdown timer calculations
  useEffect(() => {
    if (!selectedDevice) {
      setSecondsLeft(null);
      setConnectionStatus('OFFLINE');
      setPollingIntervalInput(60);
      return;
    }

    setPollingIntervalInput(selectedDevice.polling_interval || 60);

    const updateStatus = () => {
      if (selectedDevice.is_online) {
        setConnectionStatus('ONLINE_WS');
        setSecondsLeft(null);
        return;
      }

      if (!selectedDevice.last_seen) {
        setConnectionStatus('OFFLINE');
        setSecondsLeft(null);
        return;
      }

      // Calculate time difference
      const lastSeenStr = selectedDevice.last_seen;
      const cleanStr = lastSeenStr.endsWith('Z') || lastSeenStr.includes('+') ? lastSeenStr : `${lastSeenStr}Z`;
      const lastSeenDate = new Date(cleanStr);
      const diffMs = new Date() - lastSeenDate;
      const diffSec = Math.floor(diffMs / 1000);

      // Determine active status: active if seen within 2 * polling_interval + 30s buffer
      const intervalVal = selectedDevice.polling_interval || 60;
      const activeThreshold = intervalVal * 2 + 30;

      if (diffSec < activeThreshold) {
        setConnectionStatus('ONLINE_HTTP');
        const remaining = Math.max(0, intervalVal - (diffSec % intervalVal));
        setSecondsLeft(remaining);
      } else {
        setConnectionStatus('OFFLINE');
        setSecondsLeft(null);
      }
    };

    updateStatus();
    const intervalId = setInterval(updateStatus, 1000);
    return () => clearInterval(intervalId);
  }, [selectedDevice]);

  const getDeviceStatus = (dev) => {
    if (dev.is_online) return 'ONLINE_WS';
    if (!dev.last_seen) return 'OFFLINE';
    const cleanStr = dev.last_seen.endsWith('Z') || dev.last_seen.includes('+') ? dev.last_seen : `${dev.last_seen}Z`;
    const lastSeenDate = new Date(cleanStr);
    const diffSec = Math.floor((new Date() - lastSeenDate) / 1000);
    const intervalVal = dev.polling_interval || 60;
    if (diffSec < intervalVal * 2 + 30) {
      return 'ONLINE_HTTP';
    }
    return 'OFFLINE';
  };

  // Reset interactive operation tabs on device select
  useEffect(() => {
    if (selectedDevice) {
      setTerminalOutputs([]);
      setFileItems([]);
      setCurrentPath('~');
      setProcessList([]);
      setRemoteClipboard('');
    }
  }, [selectedDevice?.id]);

  // Load route-specific data on demand
  useEffect(() => {
    if (selectedDevice) {
      const parts = location.pathname.split('/');
      const currentTab = parts[parts.length - 1];
      if (currentTab === 'files' && fileItems.length === 0) {
        fetchFileList('~');
      } else if (currentTab === 'processes' && processList.length === 0) {
        refreshProcessList();
      } else if (currentTab === 'clipboard' && !remoteClipboard) {
        fetchRemoteClipboard();
      }
    }
  }, [location.pathname, selectedDevice?.id]);

  // Auto-focus terminal input on tab mount/select or navigation
  useEffect(() => {
    if (activeTab === 'terminal') {
      hiddenTerminalInputRef.current?.focus();
    }
  }, [activeTab, location.pathname]);

  // Auto-scroll terminal history to bottom on new output
  useEffect(() => {
    if (activeTab === 'terminal') {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalOutputs, activeTab]);

  // Handle real-time terminal WebSocket connection
  useEffect(() => {
    // Close existing socket if open
    if (terminalSocketRef.current) {
      terminalSocketRef.current.close();
      terminalSocketRef.current = null;
    }

    if (activeTab === 'terminal' && selectedDevice?.is_online) {
      const token = localStorage.getItem('sentinel_token');
      if (!token) return;

      const wsUrl = `${WS_BASE_URL}/api/devices/${selectedDevice.id}/terminal/ws?token=${token}`;

      console.log('Connecting terminal WebSocket to:', wsUrl);
      const ws = new WebSocket(wsUrl);
      terminalSocketRef.current = ws;

      ws.onopen = () => {
        console.log('Terminal WebSocket opened');
        const isReconnect = shellKey > 0;
        setTerminalOutputs(prev => [...prev, { 
          command: '', 
          output: isReconnect
            ? `\r\n# Shell ready. New session started on ${selectedDevice.name}.\r\n`
            : `\r\n# Connected to ${selectedDevice.name} terminal socket.\r\n`, 
          type: isReconnect ? 'success' : 'output'
        }]);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'terminal_output') {
            setTerminalOutputs(prev => {
              if (prev.length > 0 && prev[prev.length - 1].type === 'output') {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  output: parseTerminalText(updated[updated.length - 1].output, msg.output)
                };
                return updated;
              } else {
                return [...prev, { command: '', output: parseTerminalText('', msg.output), type: 'output' }];
              }
            });
          }
        } catch (err) {
          console.error('Error parsing terminal WebSocket message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('Terminal WebSocket error:', err);
        setTerminalOutputs(prev => [...prev, { 
          command: '', 
          output: '\n[WebSocket Connection Error]\n', 
          type: 'error' 
        }]);
      };

      ws.onclose = () => {
        console.log('Terminal WebSocket closed');
        setTerminalOutputs(prev => [...prev, { 
          command: '', 
          output: '\n[WebSocket Connection Closed]\n', 
          type: 'output' 
        }]);
      };
    }

    return () => {
      if (terminalSocketRef.current) {
        terminalSocketRef.current.close();
        terminalSocketRef.current = null;
      }
    };
  }, [activeTab, selectedDevice?.id, selectedDevice?.is_online, shellKey]);

  // Load USB list on selection
  useEffect(() => {
    if (selectedDevice?.is_online) {
      handleGetUsbDevices().catch(() => {});
    } else {
      setUsbDevices([]);
    }
  }, [selectedDevice?.id, selectedDevice?.is_online]);

  const handleTerminalWindowClick = () => {
    if (window.getSelection()?.toString()) return;
    hiddenTerminalInputRef.current?.focus();
  };

  const handleTerminalKeyDown = (e) => {
    const ws = terminalSocketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    // Intercept terminal control keys
    if (e.key === 'Tab') {
      e.preventDefault();
      ws.send(JSON.stringify({ type: 'terminal_input', input: '\t' }));
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      ws.send(JSON.stringify({ type: 'terminal_input', input: '\x7f' }));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      ws.send(JSON.stringify({ type: 'terminal_input', input: '\r' }));
    } else if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault();
      ws.send(JSON.stringify({ type: 'terminal_input', input: '\x03' }));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      ws.send(JSON.stringify({ type: 'terminal_input', input: '\u001b[A' }));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      ws.send(JSON.stringify({ type: 'terminal_input', input: '\u001b[B' }));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      ws.send(JSON.stringify({ type: 'terminal_input', input: '\u001b[C' }));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      ws.send(JSON.stringify({ type: 'terminal_input', input: '\u001b[D' }));
    }
  };

  const handleTerminalTextareaChange = (e) => {
    const val = e.target.value;
    if (!val) return;
    const ws = terminalSocketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'terminal_input', input: val }));
    }
    e.target.value = '';
  };

  // Terminal Handler
  const runTerminalCommand = async (e) => {
    e?.preventDefault();
    const cmd = terminalInput;
    setTerminalInput('');
    
    const ws = terminalSocketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'terminal_input',
        input: cmd + '\n'
      }));
      setTimeout(() => {
        terminalInputRef.current?.focus();
      }, 50);
    } else {
      setTerminalOutputs(prev => {
        if (prev.length > 0 && prev[prev.length - 1].type === 'output') {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            output: updated[updated.length - 1].output + '\nTerminal WebSocket is not connected. Make sure the device is online.\n'
          };
          return updated;
        } else {
          return [...prev, { command: '', output: 'Terminal WebSocket is not connected. Make sure the device is online.', type: 'error' }];
        }
      });
    }
  };

  // Live Camera Streaming & Microphone Recording & USB Operations Handlers
  const startLiveCameraStream = async () => {
    if (!selectedDevice?.is_online) {
      alert("Device is offline. Cannot stream camera.");
      return;
    }
    
    setLiveCameraFrame(null);
    setIsStreamingLive(true);
    
    // Dispatch START_LIVE_CAMERA command first to start thread on agent
    try {
      await commandsAPI.dispatch(selectedDevice.id, 'START_LIVE_CAMERA', null);
    } catch (e) {
      console.error("Failed to trigger agent live camera start command:", e);
    }
    
    // Connect WebSocket to stream frames
    const token = localStorage.getItem('sentinel_token');
    if (!token) return;
    
    const wsUrl = `${WS_BASE_URL}/api/devices/${selectedDevice.id}/terminal/ws?token=${token}`;
    
    const ws = new WebSocket(wsUrl);
    liveStreamSocketRef.current = ws;
    
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start_camera_stream" }));
    };
    
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'live_camera_frame') {
          setLiveCameraFrame(msg.frame);
        }
      } catch (err) {
        console.error(err);
      }
    };
    
    ws.onerror = (err) => {
      console.error(err);
    };
    
    ws.onclose = () => {
      setIsStreamingLive(false);
      setLiveCameraFrame(null);
    };
  };

  const stopLiveCameraStream = () => {
    const ws = liveStreamSocketRef.current;
    if (ws) {
      try {
        ws.send(JSON.stringify({ type: "stop_camera_stream" }));
      } catch (e) {}
      ws.close();
    }
    liveStreamSocketRef.current = null;
    setIsStreamingLive(false);
    setLiveCameraFrame(null);
    if (selectedDevice) {
      commandsAPI.dispatch(selectedDevice.id, 'STOP_LIVE_CAMERA', null).catch(() => {});
    }
  };

  const startLiveScreenStream = async () => {
    if (!selectedDevice?.is_online) {
      alert("Device is offline. Cannot stream screen.");
      return;
    }
    
    setLiveScreenFrame(null);
    setIsStreamingScreen(true);
    
    try {
      await commandsAPI.dispatch(selectedDevice.id, 'START_LIVE_SCREEN', null);
    } catch (e) {
      console.error("Failed to trigger agent live screen start command:", e);
    }
    
    const token = localStorage.getItem('sentinel_token');
    if (!token) return;
    
    const wsUrl = `${WS_BASE_URL}/api/devices/${selectedDevice.id}/terminal/ws?token=${token}`;
    
    const ws = new WebSocket(wsUrl);
    liveScreenSocketRef.current = ws;
    
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start_screen_stream" }));
    };
    
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'live_screen_frame') {
          setLiveScreenFrame(msg.frame);
        }
      } catch (err) {
        console.error(err);
      }
    };
    
    ws.onerror = (err) => {
      console.error(err);
    };
    
    ws.onclose = () => {
      setIsStreamingScreen(false);
      setLiveScreenFrame(null);
    };
  };

  const stopLiveScreenStream = () => {
    const ws = liveScreenSocketRef.current;
    if (ws) {
      try {
        ws.send(JSON.stringify({ type: "stop_screen_stream" }));
      } catch (e) {}
      ws.close();
    }
    liveScreenSocketRef.current = null;
    setIsStreamingScreen(false);
    setLiveScreenFrame(null);
    if (selectedDevice) {
      commandsAPI.dispatch(selectedDevice.id, 'STOP_LIVE_SCREEN', null).catch(() => {});
    }
  };

  const handleRecordAudio = async () => {
    if (!selectedDevice) return;
    setAudioRecordingLoading(true);
    try {
      const waitTime = Math.max(90, Number(audioDuration) + 30);
      await dispatchAndWait('RECORD_AUDIO', String(audioDuration), waitTime);
      // Refresh telemetry and commands logs
      const cmdData = await devicesAPI.getCommands(selectedDevice.id, 30);
      setCommands(cmdData);
    } catch (err) {
      alert('Audio Recording Failed: ' + err.message);
    } finally {
      setAudioRecordingLoading(false);
    }
  };

  const handleGetUsbDevices = async () => {
    if (!selectedDevice) return;
    try {
      const result = await dispatchAndWait('GET_USB_DEVICES', null);
      if (result) {
        const list = JSON.parse(result);
        setUsbDevices(list);
      }
    } catch (err) {
      alert('Failed to scan USB devices: ' + err.message);
    }
  };

  const handleMountUsb = async (partitionName) => {
    if (!selectedDevice) return;
    try {
      const mountPath = await dispatchAndWait('MOUNT_USB', partitionName);
      alert(`USB partition Mounted successfully at: ${mountPath}`);
      // Refresh partition view
      await handleGetUsbDevices();
      // Automatically switch to File Manager tab and open the mount directory
      setActiveTab('files');
      fetchFileList(mountPath);
    } catch (err) {
      alert('Mount partition failed: ' + err.message);
    }
  };

  // File Explorer Handlers
  const fetchFileList = async (pathStr) => {
    setFileLoading(true);
    try {
      const result = await dispatchAndWait('FILE_BROWSER', pathStr);
      const items = JSON.parse(result);
      setFileItems(items);
      setCurrentPath(pathStr);
    } catch (err) {
      alert('Failed to browse files: ' + err.message);
    } finally {
      setFileLoading(false);
    }
  };

  const handleFileClick = async (item) => {
    if (item.type === 'error') {
      alert(item.name);
      return;
    }
    const separator = currentPath.includes('\\') ? '\\' : '/';
    let newPath = '';
    if (currentPath === '/') {
      newPath = `/${item.name}`;
    } else if (currentPath === '~') {
      newPath = `~/${item.name}`;
    } else {
      newPath = `${currentPath}${separator}${item.name}`;
    }
      
    if (item.type === 'directory') {
      await fetchFileList(newPath);
    } else {
      setFileLoading(true);
      try {
        const result = await dispatchAndWait('FILE_BROWSER', newPath);
        setViewedFileContent(result);
        setViewedFileName(item.name);
      } catch (err) {
        alert('Failed to read file: ' + err.message);
      } finally {
        setFileLoading(false);
      }
    }
  };

  const handleDownloadFile = async (item) => {
    if (!selectedDevice) return;
    setDownloadingItemName(item.name);
    
    const separator = currentPath.includes('\\') ? '\\' : '/';
    let fullPath = '';
    if (currentPath === '/') {
      fullPath = `/${item.name}`;
    } else if (currentPath === '~') {
      fullPath = `~/${item.name}`;
    } else {
      fullPath = `${currentPath}${separator}${item.name}`;
    }
    
    try {
      const downloadUrlPath = await dispatchAndWait('DOWNLOAD_FILE', fullPath);
      
      const parts = downloadUrlPath.split('/');
      const uniqueId = parts[parts.length - 2];
      const filename = parts[parts.length - 1];
      
      const blobData = await devicesAPI.downloadFile(selectedDevice.id, uniqueId, filename);
      
      const blob = new Blob([blobData]);
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloadingItemName(null);
    }
  };

  // Process Monitor Handlers
  const refreshProcessList = async () => {
    setProcessLoading(true);
    try {
      const result = await dispatchAndWait('PROCESSES', null);
      const items = JSON.parse(result);
      setProcessList(items);
    } catch (err) {
      alert('Failed to load processes: ' + err.message);
    } finally {
      setProcessLoading(false);
    }
  };

  const killProcess = async (pid) => {
    if (!window.confirm(`Are you sure you want to kill process ${pid}?`)) return;
    setProcessLoading(true);
    try {
      await dispatchAndWait('PROCESSES', `kill ${pid}`);
      await refreshProcessList();
    } catch (err) {
      alert('Failed to kill process: ' + err.message);
    } finally {
      setProcessLoading(false);
    }
  };

  // Clipboard Handlers
  const fetchRemoteClipboard = async () => {
    setClipboardLoading(true);
    try {
      const result = await dispatchAndWait('CLIPBOARD', null);
      setRemoteClipboard(result);
    } catch (err) {
      alert('Failed to read clipboard: ' + err.message);
    } finally {
      setClipboardLoading(false);
    }
  };

  const setRemoteClipboardVal = async () => {
    if (!newClipboardVal.trim()) return;
    setClipboardLoading(true);
    try {
      await dispatchAndWait('CLIPBOARD', newClipboardVal);
      setNewClipboardVal('');
      await fetchRemoteClipboard();
    } catch (err) {
      alert('Failed to set clipboard: ' + err.message);
    } finally {
      setClipboardLoading(false);
    }
  };

  // Deletion Actions
  const handleDeleteLog = async (cmdId) => {
    if (!window.confirm('Are you sure you want to delete this log entry?')) return;
    try {
      await commandsAPI.deleteLog(cmdId);
      const cmdData = await devicesAPI.getCommands(selectedDevice.id, 30);
      setCommands(cmdData);
    } catch (err) {
      alert('Failed to delete log: ' + err.message);
    }
  };

  const handleClearTelemetry = async () => {
    if (!selectedDevice) return;
    if (!window.confirm('Are you sure you want to clear all telemetry history for this device?')) return;
    try {
      await devicesAPI.clearTelemetry(selectedDevice.id);
      setTelemetry([]);
      alert('Telemetry history cleared successfully.');
    } catch (err) {
      console.error('Clear telemetry error:', err);
      alert('Failed to clear telemetry history: ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleUnregisterDevice = async () => {
    if (!selectedDevice) return;
    try {
      await devicesAPI.delete(selectedDevice.id);
      setIsUnregisterModalOpen(false);
      setSelectedDevice(null);
      const data = await devicesAPI.list();
      setDevices(data);
      navigate('/');
      alert('Device unregistered successfully.');
    } catch (err) {
      console.error('Unregister device error:', err);
      alert('Failed to unregister device: ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleRestartShell = async () => {
    if (!selectedDevice?.is_online) return;
    setRestartingShell(true);
    try {
      // Show restarting notice immediately
      setTerminalOutputs([{ command: '', output: '\r\n# Shell session restarting...\r\n', type: 'output' }]);

      await commandsAPI.dispatch(selectedDevice.id, 'RESTART_SHELL', null);

      // Wait for the agent to tear down and rebuild the PTY (~1.5 s is enough)
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Increment shellKey → forces terminal WS useEffect to close & reconnect
      // onopen will then print the green "Shell ready" confirmation
      setShellKey(prev => prev + 1);
    } catch (err) {
      alert('Failed to restart shell: ' + err.message);
    } finally {
      setRestartingShell(false);
    }
  };

  const startAutoScreenshot = async () => {
    if (!selectedDevice?.is_online) return;
    try {
      await commandsAPI.dispatch(selectedDevice.id, 'START_AUTO_SCREENSHOT', String(autoScreenshotInterval));
      setIsAutoScreenshot(true);
      localStorage.setItem(`auto_screenshot_active_${selectedDevice.id}`, 'true');
      localStorage.setItem(`auto_screenshot_interval_${selectedDevice.id}`, String(autoScreenshotInterval));
    } catch (err) {
      alert('Failed to start auto-screenshot: ' + err.message);
    }
  };

  const stopAutoScreenshot = async () => {
    if (!selectedDevice) return;
    try {
      await commandsAPI.dispatch(selectedDevice.id, 'STOP_AUTO_SCREENSHOT', null);
      setIsAutoScreenshot(false);
      localStorage.setItem(`auto_screenshot_active_${selectedDevice.id}`, 'false');
    } catch (err) {
      alert('Failed to stop auto-screenshot: ' + err.message);
    }
  };

  const startAutoWebcam = async () => {
    if (!selectedDevice?.is_online) return;
    try {
      await commandsAPI.dispatch(selectedDevice.id, 'START_AUTO_WEBCAM', String(autoWebcamInterval));
      setIsAutoWebcam(true);
      localStorage.setItem(`auto_webcam_active_${selectedDevice.id}`, 'true');
      localStorage.setItem(`auto_webcam_interval_${selectedDevice.id}`, String(autoWebcamInterval));
    } catch (err) {
      alert('Failed to start auto-webcam: ' + err.message);
    }
  };

  const stopAutoWebcam = async () => {
    if (!selectedDevice) return;
    try {
      await commandsAPI.dispatch(selectedDevice.id, 'STOP_AUTO_WEBCAM', null);
      setIsAutoWebcam(false);
      localStorage.setItem(`auto_webcam_active_${selectedDevice.id}`, 'false');
    } catch (err) {
      alert('Failed to stop auto-webcam: ' + err.message);
    }
  };

  // Command Dispatches
  const triggerCommand = async (type, payload = null) => {
    if (!selectedDevice) return;
    try {
      await commandsAPI.dispatch(selectedDevice.id, type, payload);
      // Refresh commands immediately
      const cmdData = await devicesAPI.getCommands(selectedDevice.id, 30);
      setCommands(cmdData);
    } catch (err) {
      alert(`Failed to send command ${type}: ` + (err.response?.data?.detail || err.message));
    }
  };

  const sendCustomMessage = () => {
    if (!customMsg.trim()) return;
    triggerCommand('MESSAGE', customMsg);
    setCustomMsg('');
    setIsMsgModalOpen(false);
  };

  const sendConfirmCommand = () => {
    triggerCommand(confirmCmdType);
    setIsConfirmModalOpen(false);
  };

  // UI Helpers
  const formatUptime = (seconds) => {
    if (!seconds) return 'N/A';
    const d = Math.floor(seconds / (3600*24));
    const h = Math.floor((seconds % (3600*24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    
    let res = '';
    if (d > 0) res += `${d}d `;
    if (h > 0) res += `${h}h `;
    res += `${m}m`;
    return res;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const cleanStr = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : `${dateStr}Z`;
    const date = new Date(cleanStr);
    return date.toLocaleString();
  };

  const getMetricBarColor = (val) => {
    if (val < 60) return 'success';
    if (val < 85) return 'warning';
    return 'danger';
  };

  const handleCopyCommand = () => {
    const token = localStorage.getItem('sentinel_token') || '';
    const hostUrl = API_BASE_URL.startsWith('http') ? API_BASE_URL : window.location.origin;
    const textToCopy = `curl -fsSL "${hostUrl}/install.sh" | sudo sh -s -- --token="${token}" --url="${hostUrl}"`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleCopyStep = (stepText, stepId) => {
    navigator.clipboard.writeText(stepText);
    setCopiedStep(stepId);
    setTimeout(() => setCopiedStep(null), 2000);
  };

  // Derived States
  const latestTelemetry = telemetry[0] || {};
  const screenshots = commands.filter(c => c.command_type === 'SCREENSHOT' && c.status === 'EXECUTED' && c.result_url);
  const webcamCaptures = commands.filter(c => c.command_type === 'WEBCAM' && c.status === 'EXECUTED' && c.result_url);
  const audioRecordings = commands.filter(c => c.command_type === 'RECORD_AUDIO' && c.status === 'EXECUTED' && c.result_url);
  const usbEvents = commands.filter(c => c.command_type === 'USB_EVENT' && c.status === 'EXECUTED');
  const locationCenter = latestTelemetry.latitude && latestTelemetry.longitude 
    ? [latestTelemetry.latitude, latestTelemetry.longitude] 
    : null;

  // 1. Render Auth / Main Layout
  return (
    <>
      <Routes>
        <Route path="/login" element={
          <div className="auth-container">
            <div className="auth-card">
              <div className="auth-logo">SENTINEL</div>
              <div className="auth-subtitle">Remote Management & Anti-Theft Console</div>
              
              {authError && <div className="error-banner">{authError}</div>}
              
              <form onSubmit={authMode === 'login' ? handleLogin : handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input 
                    type="email" 
                    className="form-input" 
                    required 
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                  />
                </div>
                
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <input 
                    type="password" 
                    className="form-input" 
                    required 
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                </div>
                
                <button type="submit" className="btn btn-primary" disabled={authLoading}>
                  {authLoading ? 'Please wait...' : (authMode === 'login' ? 'Sign In' : 'Create Account')}
                </button>
              </form>
              
              <div className="auth-switch">
                {authMode === 'login' ? (
                  <>Don't have an account? <a href="#" onClick={(e) => { e.preventDefault(); setAuthMode('register'); setAuthError(''); }}>Sign Up</a></>
                ) : (
                  <>Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); setAuthMode('login'); setAuthError(''); }}>Sign In</a></>
                )}
              </div>
            </div>
          </div>
        } />

        <Route path="/*" element={
          <div className="dashboard-layout">
            {/* Sidebar Component */}
            <div className={`sidebar ${isMobileSidebarOpen ? 'mobile-open' : ''}`}>
              <div className="sidebar-header">
                <div className="sidebar-logo">SENTINEL</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button className="btn btn-secondary" style={{ padding: '6px' }} onClick={fetchDevices} title="Refresh Device List">
                    <RefreshCw size={14} />
                  </button>
                  <button className="btn btn-secondary mobile-close-btn" style={{ padding: '6px' }} onClick={() => setIsMobileSidebarOpen(false)} title="Close Sidebar">
                    <X size={14} />
                  </button>
                </div>
              </div>
              
              <div className="device-list-container">
                <div className="device-list-title">My Devices</div>
                
                {devices.length === 0 ? (
                  <div style={{ padding: '12px', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center' }}>
                    No devices found. Click "+" below to register one.
                  </div>
                ) : (
                  devices.map(dev => (
                    <div 
                      key={dev.id} 
                      className={`device-item ${selectedDevice?.id === dev.id ? 'active' : ''}`}
                      onClick={() => {
                        const parts = location.pathname.split('/');
                        const currentTab = parts[parts.length - 1] || 'telemetry';
                        const tabList = ['telemetry', 'controls', 'console', 'forensics', 'audit'];
                        const targetTab = tabList.includes(currentTab) ? currentTab : 'telemetry';
                        navigate(`/device/${dev.id}/${targetTab}`);
                        setIsMobileSidebarOpen(false);
                      }}
                    >
                      <div className="device-info">
                        <div className="device-name">{dev.name}</div>
                        <div className="device-hostname">{dev.hostname} ({dev.os})</div>
                      </div>
                      {(() => {
                        const status = getDeviceStatus(dev);
                        if (status === 'ONLINE_WS') return <div className="status-dot online" title="Online (WebSocket)" />;
                        if (status === 'ONLINE_HTTP') return <div className="status-dot warning" style={{ background: 'var(--color-warning)' }} title="Online (HTTP Polling)" />;
                        return <div className="status-dot offline" title="Offline" />;
                      })()}
                    </div>
                  ))
                )}
              </div>
              
              <div className="sidebar-footer">
                <button className="btn btn-primary" style={{ gap: '6px' }} onClick={() => { setIsRegModalOpen(true); setIsMobileSidebarOpen(false); }}>
                  <Plus size={16} /> Register Device
                </button>
                
                <div className="user-profile">
                  <div className="user-email" title={user?.email || ''}>
                    <User size={14} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'text-bottom' }} />
                    {user?.email || ''}
                  </div>
                  <button className="close-btn" onClick={handleLogout} title="Log Out">
                    <LogOut size={16} />
                  </button>
                </div>
              </div>
            </div>

            {isMobileSidebarOpen && (
              <div 
                className="sidebar-overlay" 
                onClick={() => setIsMobileSidebarOpen(false)}
              />
            )}

            {/* Main Panel Area */}
            <div className="main-panel">
              {selectedDevice ? (
                <>
                  {/* Main Header */}
                  <div className="header">
                    <div className="header-device-info">
                      <button className="btn btn-secondary mobile-menu-btn" style={{ padding: '8px', display: 'none', alignItems: 'center', justifyContent: 'center' }} onClick={() => setIsMobileSidebarOpen(true)} title="Open Sidebar">
                        <Menu size={18} />
                      </button>
                      <div className="header-device-name">{selectedDevice.name}</div>
                      {connectionStatus === 'ONLINE_WS' && (
                        <div className="badge badge-executed" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="status-dot online" style={{ margin: 0, width: '8px', height: '8px' }} />
                          ONLINE (WS)
                        </div>
                      )}
                      {connectionStatus === 'ONLINE_HTTP' && (
                        <div className="badge badge-warning" style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(245,158,11,0.1)', color: 'var(--color-warning)', border: '1px solid rgba(245,158,11,0.2)' }}>
                          <span className="status-dot warning" style={{ margin: 0, width: '8px', height: '8px', background: 'var(--color-warning)' }} />
                          ONLINE (HTTP)
                          <span style={{ fontSize: '10px', opacity: 0.8, marginLeft: '4px' }}>
                            (Check-in: {secondsLeft}s)
                          </span>
                        </div>
                      )}
                      {connectionStatus === 'OFFLINE' && (
                        <div className="badge badge-failed" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="status-dot offline" style={{ margin: 0, width: '8px', height: '8px' }} />
                          OFFLINE
                        </div>
                      )}
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        ID: {selectedDevice.id}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        API Key: <code>{selectedDevice.api_key}</code>
                      </span>
                      <button className="btn btn-secondary" style={{ padding: '8px 12px', gap: '6px' }} onClick={() => fetchDeviceData(selectedDevice.id)}>
                        <RefreshCw size={14} /> Refresh Logs
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '8px 12px', gap: '6px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: 'var(--color-danger)' }} onClick={handleClearTelemetry} title="Clear Telemetry Logs">
                        <Trash2 size={14} /> Clear Telemetry
                      </button>
                      <button className="btn btn-danger" style={{ padding: '8px 12px', gap: '6px' }} onClick={() => setIsUnregisterModalOpen(true)} title="Unregister and delete device permanently">
                        <Trash2 size={14} /> Unregister Device
                      </button>
                    </div>
                  </div>

                  {/* Dashboard Content Area */}
                  <div className="content-area">
                    {/* Top Navigation Tabs Bar */}
                    <div className="topbar-nav">
                      <button 
                        className={`topbar-nav-item ${location.pathname.includes('/telemetry') ? 'active' : ''}`}
                        onClick={() => navigate(`/device/${selectedDevice.id}/telemetry`)}
                      >
                        <Cpu size={16} /> Live Telemetry
                      </button>
                      <button 
                        className={`topbar-nav-item ${location.pathname.includes('/controls') ? 'active' : ''}`}
                        onClick={() => navigate(`/device/${selectedDevice.id}/controls`)}
                      >
                        <Lock size={16} /> Remote Administration
                      </button>
                      <button 
                        className={`topbar-nav-item ${location.pathname.includes('/console') ? 'active' : ''}`}
                        onClick={() => navigate(`/device/${selectedDevice.id}/console`)}
                      >
                        <Terminal size={16} /> Interactive Console
                      </button>
                      <button 
                        className={`topbar-nav-item ${location.pathname.includes('/forensics') ? 'active' : ''}`}
                        onClick={() => navigate(`/device/${selectedDevice.id}/forensics`)}
                      >
                        <ImageIcon size={16} /> Forensic Evidence
                      </button>
                      <button 
                        className={`topbar-nav-item ${location.pathname.includes('/audit') ? 'active' : ''}`}
                        onClick={() => navigate(`/device/${selectedDevice.id}/audit`)}
                      >
                        <Activity size={16} /> Command Logs
                      </button>
                    </div>

                    <Routes>
                      {/* Route 1: Telemetry */}
                      <Route path="device/:deviceId/telemetry" element={
                        <>
                          <CollapsibleCard title="Real-Time System Telemetry Metrics" icon={Activity} defaultOpen={true}>
                            <div className="metrics-grid">
                              <div className="metric-card">
                                <div className="metric-header">
                                  <span>CPU LOAD</span>
                                  <Cpu size={16} className="metric-icon" />
                                </div>
                                <div className="metric-value">
                                  {latestTelemetry.cpu_usage !== undefined ? `${latestTelemetry.cpu_usage}%` : 'N/A'}
                                </div>
                                {latestTelemetry.cpu_usage !== undefined && (
                                  <div className="metric-bar-container">
                                    <div 
                                      className={`metric-bar ${getMetricBarColor(latestTelemetry.cpu_usage)}`} 
                                      style={{ width: `${latestTelemetry.cpu_usage}%` }} 
                                    />
                                  </div>
                                )}
                              </div>

                              <div className="metric-card">
                                <div className="metric-header">
                                  <span>RAM USAGE</span>
                                  <Monitor size={16} className="metric-icon" />
                                </div>
                                <div className="metric-value">
                                  {latestTelemetry.ram_usage !== undefined ? `${latestTelemetry.ram_usage}%` : 'N/A'}
                                </div>
                                {latestTelemetry.ram_usage !== undefined && (
                                  <div className="metric-bar-container">
                                    <div 
                                      className={`metric-bar ${getMetricBarColor(latestTelemetry.ram_usage)}`} 
                                      style={{ width: `${latestTelemetry.ram_usage}%` }} 
                                    />
                                  </div>
                                )}
                              </div>

                              <div className="metric-card">
                                <div className="metric-header">
                                  <span>DISK SPACE</span>
                                  <HardDrive size={16} className="metric-icon" />
                                </div>
                                <div className="metric-value">
                                  {latestTelemetry.disk_usage !== undefined ? `${latestTelemetry.disk_usage}%` : 'N/A'}
                                </div>
                                {latestTelemetry.disk_usage !== undefined && (
                                  <div className="metric-bar-container">
                                    <div 
                                      className={`metric-bar ${getMetricBarColor(latestTelemetry.disk_usage)}`} 
                                      style={{ width: `${latestTelemetry.disk_usage}%` }} 
                                    />
                                  </div>
                                )}
                              </div>

                              <div className="metric-card">
                                <div className="metric-header">
                                  <span>BATTERY</span>
                                  <Battery size={16} className="metric-icon" />
                                </div>
                                <div className="metric-value">
                                  {latestTelemetry.battery_percent !== undefined 
                                    ? `${latestTelemetry.battery_percent}%` 
                                    : 'N/A'
                                  }
                                  {latestTelemetry.battery_charging && (
                                    <span style={{ fontSize: '12px', color: 'var(--color-success)', marginLeft: '8px' }}>Charging</span>
                                  )}
                                </div>
                                {latestTelemetry.battery_percent !== undefined && (
                                  <div className="metric-bar-container">
                                    <div 
                                      className={`metric-bar ${latestTelemetry.battery_charging ? 'success' : getMetricBarColor(100 - latestTelemetry.battery_percent)}`} 
                                      style={{ width: `${latestTelemetry.battery_percent}%` }} 
                                    />
                                  </div>
                                )}
                              </div>

                              <div className="metric-card">
                                <div className="metric-header">
                                  <span>SYSTEM UPTIME</span>
                                  <Clock size={16} className="metric-icon" />
                                </div>
                                <div className="metric-value" style={{ fontSize: '22px', paddingTop: '4px' }}>
                                  {formatUptime(latestTelemetry.uptime)}
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                  SSID: {latestTelemetry.wifi_ssid || 'Unknown'}
                                </div>
                              </div>
                            </div>
                          </CollapsibleCard>

                          {/* Geographic Tracking Map */}
                          <CollapsibleCard 
                            title="Location Tracker (IP/Network Estimation)" 
                            icon={MapPin} 
                            defaultOpen={true}
                            subtitle={latestTelemetry.public_ip ? `IP Address: ${latestTelemetry.public_ip}` : ''}
                            contentStyle={{ padding: '0' }}
                          >
                            <React.Suspense fallback={
                              <div className="section-content">
                                <div className="map-placeholder">
                                  <MapPin size={32} />
                                  <div>Loading Map...</div>
                                </div>
                              </div>
                            }>
                              <LocationMap 
                                locationCenter={locationCenter} 
                                selectedDevice={selectedDevice} 
                                latestTelemetry={latestTelemetry} 
                              />
                            </React.Suspense>
                          </CollapsibleCard>

                          {/* System & Hardware Info Card */}
                          <CollapsibleCard title="System & Hardware Information" icon={Cpu} defaultOpen={true}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                              {/* Left Side: System Details */}
                              <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px' }}>
                                <h4 style={{ marginBottom: '12px', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <Monitor size={16} /> Device Identifiers
                                </h4>
                                <table className="info-table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                                  <tbody>
                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                      <td style={{ padding: '8px 0', color: 'var(--text-muted)', width: '40%' }}>Hostname:</td>
                                      <td style={{ padding: '8px 0', fontFamily: 'var(--font-mono)' }}>{selectedDevice.hostname || 'N/A'}</td>
                                    </tr>
                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                      <td style={{ padding: '8px 0', color: 'var(--text-muted)' }}>OS Version:</td>
                                      <td style={{ padding: '8px 0' }}>{selectedDevice.os || 'Linux'}</td>
                                    </tr>
                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                      <td style={{ padding: '8px 0', color: 'var(--text-muted)' }}>MAC Address:</td>
                                      <td style={{ padding: '8px 0', fontFamily: 'var(--font-mono)' }}>{latestTelemetry.mac_address || 'N/A'}</td>
                                    </tr>
                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                      <td style={{ padding: '8px 0', color: 'var(--text-muted)' }}>Public IP:</td>
                                      <td style={{ padding: '8px 0', fontFamily: 'var(--font-mono)' }}>{latestTelemetry.public_ip || 'N/A'}</td>
                                    </tr>
                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                      <td style={{ padding: '8px 0', color: 'var(--text-muted)' }}>Local IP:</td>
                                      <td style={{ padding: '8px 0', fontFamily: 'var(--font-mono)' }}>{latestTelemetry.local_ip || 'N/A'}</td>
                                    </tr>
                                    <tr>
                                      <td style={{ padding: '8px 0', color: 'var(--text-muted)' }}>Wi-Fi Connection:</td>
                                      <td style={{ padding: '8px 0' }}>{latestTelemetry.wifi_ssid || 'Disconnected'}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>

                              {/* Right Side: Network Interfaces */}
                              <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px' }}>
                                <h4 style={{ marginBottom: '12px', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <HardDrive size={16} /> Network Interfaces
                                </h4>
                                <div style={{ maxHeight: '180px', overflowY: 'auto', fontSize: '12px' }}>
                                  {latestTelemetry.network_info ? (
                                    (() => {
                                      try {
                                        const interfaces = JSON.parse(latestTelemetry.network_info);
                                        return Object.entries(interfaces).map(([name, addrs]) => (
                                          <div key={name} style={{ marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                            <div style={{ fontWeight: 'bold', color: 'var(--color-success)', fontFamily: 'var(--font-mono)' }}>{name}</div>
                                            {Array.isArray(addrs) && addrs.map((addr, idx) => (
                                              <div key={idx} className="network-addr-row">
                                                <span style={{ color: 'var(--text-muted)' }}>{addr.family}</span>
                                                <span style={{ fontFamily: 'var(--font-mono)' }}>{addr.address}</span>
                                              </div>
                                            ))}
                                          </div>
                                        ));
                                      } catch (e) {
                                        return <div style={{ color: 'var(--color-danger)' }}>Error parsing network info</div>;
                                      }
                                    })()
                                  ) : (
                                    <div style={{ color: 'var(--text-muted)' }}>No network interface data received.</div>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Row 2 inside System Details: Nearby Wi-Fi scan list */}
                            <div style={{ marginTop: '20px', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px' }}>
                              <h4 style={{ marginBottom: '12px', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Volume2 size={16} /> Nearby Wi-Fi Networks
                              </h4>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px', maxHeight: '150px', overflowY: 'auto' }}>
                                {latestTelemetry.nearby_wifi ? (
                                  (() => {
                                    try {
                                      const networks = JSON.parse(latestTelemetry.nearby_wifi);
                                      if (!networks || networks.length === 0) {
                                        return <div style={{ color: 'var(--text-muted)', gridColumn: '1 / -1' }}>No nearby Wi-Fi networks detected.</div>;
                                      }
                                      return networks.map((net, idx) => (
                                        <div 
                                          key={idx} 
                                          style={{ 
                                            background: 'rgba(255,255,255,0.02)', 
                                            border: '1px solid rgba(255,255,255,0.05)', 
                                            borderRadius: '6px', 
                                            padding: '8px 12px',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                          }}
                                        >
                                          <span style={{ fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', display: 'flex', alignItems: 'center', gap: '6px' }} title={net.ssid}>
                                            <Wifi size={12} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                                            {net.ssid || '[Hidden SSID]'}
                                          </span>
                                        </div>
                                      ));
                                    } catch (e) {
                                      return <div style={{ color: 'var(--color-danger)', gridColumn: '1 / -1' }}>Error parsing Wi-Fi scan</div>;
                                    }
                                  })()
                                ) : (
                                  <div style={{ color: 'var(--text-muted)', gridColumn: '1 / -1' }}>No nearby Wi-Fi network telemetry received.</div>
                                )}
                              </div>
                            </div>
                          </CollapsibleCard>
                        </>
                      } />

                      {/* Route 2: Remote Controls */}
                      <Route path="device/:deviceId/controls" element={
                        <>
                          {/* Remote Administration Panel */}
                          <CollapsibleCard 
                            title="Remote Administration Console" 
                            icon={Terminal} 
                            defaultOpen={true}
                            isOnlineBadge={
                              connectionStatus === 'ONLINE_WS' ? (
                                <div className="badge badge-executed">
                                  Real-time WebSocket connection active
                                </div>
                              ) : connectionStatus === 'ONLINE_HTTP' ? (
                                <div className="badge badge-warning" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--color-warning)', border: '1px solid rgba(245,158,11,0.2)' }}>
                                  HTTP Polling active (Next check in {secondsLeft}s)
                                </div>
                              ) : (
                                <div className="badge badge-failed">
                                  Device disconnected: Commands will queue
                                </div>
                              )
                            }
                          >
                            <div style={{ marginBottom: '20px', padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                              <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: 'var(--color-accent)' }}>Agent HTTP Polling Settings</h4>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                  Heartbeat Interval (seconds):
                                </label>
                                <input 
                                  type="number" 
                                  min="5" 
                                  max="3600"
                                  className="form-input"
                                  style={{ width: '100px', padding: '6px 10px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', color: 'white', borderRadius: '4px' }}
                                  value={pollingIntervalInput}
                                  onChange={e => setPollingIntervalInput(Number(e.target.value))}
                                />
                                <button 
                                  className="btn btn-primary"
                                  style={{ padding: '6px 14px', fontSize: '13px' }}
                                  onClick={async () => {
                                    try {
                                      const val = Math.max(5, Number(pollingIntervalInput));
                                      await devicesAPI.update(selectedDevice.id, { polling_interval: val });
                                      alert('Polling interval updated successfully!');
                                      // Refresh device lists
                                      fetchDevices();
                                    } catch (err) {
                                      alert('Failed to update polling interval: ' + err.message);
                                    }
                                  }}
                                >
                                  Update Interval
                                </button>
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                  (Min: 5s, Max: 3600s. Applied dynamically on the next agent heartbeat.)
                                </span>
                              </div>
                            </div>

                            <div className="commands-grid">
                              <button className="command-button" onClick={() => triggerCommand('SCREENSHOT')}>
                                <div className="command-button-icon"><Camera size={20} /></div>
                                <div className="command-button-label">Capture Screenshot</div>
                                <div className="command-button-desc">Grab active display output</div>
                              </button>

                              <button className="command-button" onClick={() => triggerCommand('WEBCAM')}>
                                <div className="command-button-icon"><Camera size={20} /></div>
                                <div className="command-button-label">Capture Webcam</div>
                                <div className="command-button-desc">Take camera frame snapshot</div>
                              </button>

                              <button className="command-button" onClick={() => triggerCommand('LOCK')}>
                                <div className="command-button-icon"><Lock size={20} /></div>
                                <div className="command-button-label">Lock Session</div>
                                <div className="command-button-desc">Trigger user display lock</div>
                              </button>

                              <button className="command-button" onClick={() => setIsMsgModalOpen(true)}>
                                <div className="command-button-icon"><Bell size={20} /></div>
                                <div className="command-button-label">Display Warning</div>
                                <div className="command-button-desc">Show custom warning alert</div>
                              </button>

                              <button className="command-button" onClick={() => triggerCommand('ALARM')}>
                                <div className="command-button-icon"><Volume2 size={20} /></div>
                                <div className="command-button-label">Trigger Alarm</div>
                                <div className="command-button-desc">Play siren / audio tone</div>
                              </button>

                              <button className="command-button" onClick={() => triggerCommand('STOP_ALARM')}>
                                <div className="command-button-icon" style={{ color: 'var(--color-success)', background: 'rgba(16,185,129,0.1)' }}><Volume2 size={20} /></div>
                                <div className="command-button-label">Silence Alarm</div>
                                <div className="command-button-desc">Stop sounding alarm siren</div>
                              </button>

                              <button className="command-button" onClick={() => { setConfirmCmdType('RESTART'); setIsConfirmModalOpen(true); }}>
                                <div className="command-button-icon" style={{ color: 'var(--color-warning)', background: 'rgba(245,158,11,0.1)' }}><RefreshCw size={20} /></div>
                                <div className="command-button-label">Reboot System</div>
                                <div className="command-button-desc">Initiate immediate system restart</div>
                              </button>

                              <button className="command-button" onClick={() => { setConfirmCmdType('SHUTDOWN'); setIsConfirmModalOpen(true); }}>
                                <div className="command-button-icon" style={{ color: 'var(--color-danger)', background: 'rgba(239,68,68,0.1)' }}><Power size={20} /></div>
                                <div className="command-button-label">Power Off</div>
                                <div className="command-button-desc">Perform remote power shutdown</div>
                              </button>

                              <button className="command-button" onClick={() => triggerCommand('RESTART_AGENT')}>
                                <div className="command-button-icon" style={{ color: 'var(--color-accent)', background: 'rgba(59,130,246,0.1)' }}><RefreshCw size={20} /></div>
                                <div className="command-button-label">Restart Agent</div>
                                <div className="command-button-desc">Reload agent runtime script</div>
                              </button>
                            </div>
                          </CollapsibleCard>

                          {/* Live Web Camera Streaming Console */}
                          <CollapsibleCard title="Live Web Camera Stream (Real-Time WebSocket)" icon={Camera} defaultOpen={false}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                              <div style={{ background: '#090d16', border: '1px solid var(--border-color)', borderRadius: '8px', aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
                                {isStreamingLive ? (
                                  liveCameraFrame ? (<img src={liveCameraFrame} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Live Webcam Feed" />) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}><div className="loading-spinner"></div><span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Waiting for device video frames...</span></div>
                                  )
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}><Camera size={36} style={{ opacity: 0.3 }} /><span style={{ fontSize: '13px' }}>Webcam stream is inactive. Click start below.</span></div>
                                )}
                                {isStreamingLive && (<span style={{ position: 'absolute', top: '12px', left: '12px', background: 'rgba(239,68,68,0.85)', color: 'white', fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}><span className="live-dot" style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'white' }}></span>LIVE FEED</span>)}
                              </div>
                              <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '16px' }}>
                                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>Launch continuous, low-latency live camera streaming directly from the device's default optical interface.</div>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                  {!isStreamingLive ? (
                                    <button className="btn btn-primary" style={{ flex: 1, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={startLiveCameraStream}><Play size={16} /> Start Live Stream</button>
                                  ) : (
                                    <button className="btn btn-danger" style={{ flex: 1, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={stopLiveCameraStream}><Power size={16} /> Stop Live Stream</button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </CollapsibleCard>

                          {/* Live Screen Streaming Console */}
                          <CollapsibleCard title="Live Screen Capture Stream (Real-Time WebSocket)" icon={Monitor} defaultOpen={false}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                              <div style={{ background: '#090d16', border: '1px solid var(--border-color)', borderRadius: '8px', aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
                                {isStreamingScreen ? (
                                  liveScreenFrame ? (<img src={liveScreenFrame} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="Live Screen Feed" />) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}><div className="loading-spinner"></div><span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Waiting for screen frames...</span></div>
                                  )
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}><Monitor size={36} style={{ opacity: 0.3 }} /><span style={{ fontSize: '13px' }}>Screen stream is inactive. Click start below.</span></div>
                                )}
                                {isStreamingScreen && (<span style={{ position: 'absolute', top: '12px', left: '12px', background: 'rgba(239,68,68,0.85)', color: 'white', fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}><span className="live-dot" style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'white' }}></span>LIVE SCREEN</span>)}
                              </div>
                              <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '16px' }}>
                                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>Stream the active desktop workspace in real-time. Frames are compressed and sent at low latency over the WebSocket connection.</div>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                  {!isStreamingScreen ? (
                                    <button className="btn btn-primary" style={{ flex: 1, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={startLiveScreenStream}><Play size={16} /> Start Screen Stream</button>
                                  ) : (
                                    <button className="btn btn-danger" style={{ flex: 1, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={stopLiveScreenStream}><Power size={16} /> Stop Screen Stream</button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </CollapsibleCard>

                          {/* Remote Microphone Recording */}
                          <CollapsibleCard title="Remote Microphone Auditing" icon={Volume2} defaultOpen={false}>
                            <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'center' }}>
                                <div style={{ flex: 1, minWidth: '200px' }}>
                                  <div style={{ fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>Recording Duration (Seconds)</div>
                                  <select className="form-input" style={{ width: '100%', background: '#0d131f', border: '1px solid var(--border-color)', color: 'white', padding: '8px', borderRadius: '4px' }} value={audioDuration} onChange={(e) => setAudioDuration(Number(e.target.value))}>
                                    <option value={10}>10 Seconds (Quick Snippet)</option>
                                    <option value={30}>30 Seconds (Standard Check)</option>
                                    <option value={60}>60 Seconds (Extended Audit)</option>
                                  </select>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'flex-end', paddingTop: '20px' }}>
                                  <button className="btn btn-primary" onClick={handleRecordAudio} disabled={audioRecordingLoading} style={{ padding: '10px 24px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                    <Volume2 size={16} />{audioRecordingLoading ? 'Recording audio...' : 'Trigger Audio Capture'}
                                  </button>
                                </div>
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '12px' }}>* Utilizes ALSA PCM recording framework. Recorded audio is uploaded and playable inside the Forensic Evidence tab.</div>
                            </div>
                          </CollapsibleCard>

                          {/* Auto-Capture Scheduler */}
                          <CollapsibleCard title="Automatic Capture Scheduler" icon={Timer} defaultOpen={false}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                              {/* Auto Screenshot Card */}
                              <div style={{ background: 'rgba(255,255,255,0.01)', border: `1px solid ${isAutoScreenshot ? 'rgba(16,185,129,0.4)' : 'var(--border-color)'}`, borderRadius: '8px', padding: '20px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: isAutoScreenshot ? 'var(--color-success)' : 'var(--text-primary)' }}>
                                    <Camera size={16} /> Auto Screenshot
                                  </h4>
                                  {isAutoScreenshot && (<span className="badge badge-executed" style={{ fontSize: '10px', background: 'rgba(16,185,129,0.15)' }}>ACTIVE</span>)}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>Automatically capture and upload a silent screenshot on a set interval.</div>
                                <div style={{ marginBottom: '14px' }}>
                                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Interval (seconds)</label>
                                  <input type="number" className="form-input" min="10" max="3600" value={autoScreenshotInterval} onChange={e => setAutoScreenshotInterval(Math.max(10, Number(e.target.value)))} disabled={isAutoScreenshot} style={{ width: '100%' }} />
                                </div>
                                {!isAutoScreenshot ? (
                                  <button className="btn btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={startAutoScreenshot} disabled={!selectedDevice?.is_online}><Play size={14} /> Start Auto-Capture</button>
                                ) : (
                                  <button className="btn btn-danger" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={stopAutoScreenshot}><Power size={14} /> Stop Auto-Capture</button>
                                )}
                              </div>

                              {/* Auto Webcam Card */}
                              <div style={{ background: 'rgba(255,255,255,0.01)', border: `1px solid ${isAutoWebcam ? 'rgba(16,185,129,0.4)' : 'var(--border-color)'}`, borderRadius: '8px', padding: '20px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: isAutoWebcam ? 'var(--color-success)' : 'var(--text-primary)' }}>
                                    <Camera size={16} /> Auto Webcam
                                  </h4>
                                  {isAutoWebcam && (<span className="badge badge-executed" style={{ fontSize: '10px', background: 'rgba(16,185,129,0.15)' }}>ACTIVE</span>)}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>Automatically capture webcam frames at a set interval and upload them silently.</div>
                                <div style={{ marginBottom: '14px' }}>
                                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Interval (seconds)</label>
                                  <input type="number" className="form-input" min="10" max="3600" value={autoWebcamInterval} onChange={e => setAutoWebcamInterval(Math.max(10, Number(e.target.value)))} disabled={isAutoWebcam} style={{ width: '100%' }} />
                                </div>
                                {!isAutoWebcam ? (
                                  <button className="btn btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={startAutoWebcam} disabled={!selectedDevice?.is_online}><Play size={14} /> Start Auto-Capture</button>
                                ) : (
                                  <button className="btn btn-danger" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={stopAutoWebcam}><Power size={14} /> Stop Auto-Capture</button>
                                )}
                              </div>
                            </div>
                          </CollapsibleCard>
                        </>
                      } />

                      {/* Route 3: Console (Interactive Tabs) */}
                      <Route path="device/:deviceId/console" element={
                        <CollapsibleCard title="Interactive Remote Operations Console" icon={Terminal} defaultOpen={true}>
                            <div className="tabs-container">
                              <button 
                                className={`tab-btn ${activeTab === 'terminal' ? 'active' : ''}`}
                                onClick={() => setActiveTab('terminal')}
                              >
                                <Terminal size={16} /> Terminal
                              </button>
                              <button 
                                className={`tab-btn ${activeTab === 'files' ? 'active' : ''}`}
                                onClick={() => setActiveTab('files')}
                              >
                                <Folder size={16} /> File Manager
                              </button>
                              <button 
                                className={`tab-btn ${activeTab === 'processes' ? 'active' : ''}`}
                                onClick={() => setActiveTab('processes')}
                              >
                                <Activity size={16} /> Process Monitor
                              </button>
                              <button 
                                className={`tab-btn ${activeTab === 'clipboard' ? 'active' : ''}`}
                                onClick={() => setActiveTab('clipboard')}
                              >
                                <Clipboard size={16} /> Clipboard Access
                              </button>
                            </div>

                            {/* Terminal Tab View */}
                            {activeTab === 'terminal' && (
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '8px' }}>
                                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', flex: 1 }}>
                                    Click inside the terminal box below and type directly. Tab, Ctrl+C, and arrow history supported.
                                  </span>
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    <button 
                                      className="btn btn-secondary" 
                                      style={{ padding: '4px 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                      onClick={handleRestartShell}
                                      disabled={restartingShell || !selectedDevice?.is_online}
                                      title="Kill the current shell process and spawn a fresh one"
                                    >
                                      <RotateCcw size={12} />
                                      {restartingShell ? 'Restarting...' : 'New Shell'}
                                    </button>
                                    <button 
                                      className="btn btn-secondary" 
                                      style={{ padding: '4px 12px', fontSize: '12px' }}
                                      onClick={() => setTerminalOutputs([{ command: '', output: '', type: 'output' }])}
                                    >
                                      Clear Screen
                                    </button>
                                  </div>
                                </div>
                                <div 
                                  className="terminal-window" 
                                  onClick={handleTerminalWindowClick}
                                  style={{ 
                                    position: 'relative', 
                                    cursor: 'text',
                                    height: '420px',
                                    display: 'flex',
                                    flexDirection: 'column'
                                  }}
                                >
                                  <textarea
                                    ref={hiddenTerminalInputRef}
                                    style={{
                                      position: 'absolute',
                                      opacity: 0,
                                      height: '1px',
                                      width: '1px',
                                      left: '0',
                                      top: '0',
                                      zIndex: 0,
                                      pointerEvents: 'auto',
                                      border: 'none',
                                      outline: 'none',
                                      background: 'transparent',
                                      resize: 'none'
                                    }}
                                    value=""
                                    onChange={handleTerminalTextareaChange}
                                    onKeyDown={handleTerminalKeyDown}
                                  />
                                  <div className="terminal-history" style={{ flex: 1, borderBottom: 'none', paddingBottom: 0 }}>
                                    <div className="terminal-line" style={{ color: 'var(--text-muted)' }}>
                                      # Sentinel Interactive Terminal initialized.
                                    </div>
                                    {terminalOutputs.map((item, idx) => (
                                      <div key={idx}>
                                        {item.type === 'output' ? (
                                          <pre className="terminal-output" style={{ margin: 0, padding: 0, background: 'transparent', borderLeft: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                            {String(item.output || '')}
                                            {idx === terminalOutputs.length - 1 && <span className="terminal-cursor" />}
                                          </pre>
                                        ) : item.type === 'success' ? (
                                          <pre className="terminal-output" style={{ margin: 0, padding: 0, background: 'transparent', borderLeft: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--color-success)' }}>
                                            {String(item.output || '')}
                                            {idx === terminalOutputs.length - 1 && <span className="terminal-cursor" />}
                                          </pre>
                                        ) : (
                                          <pre className="terminal-error" style={{ margin: 0, padding: 0, background: 'transparent', borderLeft: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                            {String(item.output || '')}
                                            {idx === terminalOutputs.length - 1 && <span className="terminal-cursor" />}
                                          </pre>
                                        )}
                                      </div>
                                    ))}
                                    <div ref={terminalEndRef} />
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* File Manager Tab View */}
                            {activeTab === 'files' && (
                              <div>
                                <div className="quick-paths">
                                  <span style={{ fontSize: '13px', alignSelf: 'center', color: 'var(--text-secondary)' }}>Quick Paths:</span>
                                  <button className="quick-path-btn" onClick={() => fetchFileList('~')}>Home (~)</button>
                                  <button className="quick-path-btn" onClick={() => fetchFileList('/')}>Root (/)</button>
                                  <button className="quick-path-btn" onClick={() => fetchFileList('/tmp')}>/tmp</button>
                                  <button className="quick-path-btn" onClick={() => fetchFileList('/var/log')}>/var/log</button>
                                  <button className="quick-path-btn" onClick={() => fetchFileList('/etc')}>/etc</button>
                                </div>

                                <div className="path-breadcrumbs">
                                  <Folder size={16} style={{ color: 'var(--color-accent)' }} />
                                  <span style={{ fontWeight: '500' }}>{currentPath}</span>
                                  <button 
                                    className="btn btn-secondary action-btn-sm" 
                                    style={{ marginLeft: 'auto', padding: '4px 8px' }}
                                    onClick={() => {
                                      const parts = currentPath.split('/');
                                      parts.pop();
                                      const parent = parts.join('/') || '/';
                                      fetchFileList(parent);
                                    }}
                                    disabled={currentPath === '/' || fileLoading}
                                  >
                                    Up One Level
                                  </button>
                                </div>

                                {fileLoading ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px', gap: '12px' }}>
                                    <div className="loading-spinner"></div>
                                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Loading directory tree...</span>
                                  </div>
                                ) : (
                                  <div style={{ maxHeight: '360px', overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                                    <table className="file-table log-table">
                                      <thead>
                                        <tr>
                                          <th>Name</th>
                                          <th style={{ width: '120px' }}>Type</th>
                                          <th style={{ width: '120px' }}>Size (Bytes)</th>
                                          <th style={{ width: '150px' }}>Last Modified</th>
                                          <th style={{ width: '120px', textAlign: 'center' }}>Action</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {fileItems.length === 0 ? (
                                          <tr>
                                            <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Empty directory or permission denied.</td>
                                          </tr>
                                        ) : (
                                          fileItems.map((item, idx) => (
                                            <tr key={idx} className="file-row" style={{ cursor: 'pointer' }} onClick={() => handleFileClick(item)}>
                                              <td>
                                                <div className="file-icon">
                                                  {item.type === 'directory' ? <Folder size={16} style={{ color: 'var(--color-warning)' }} /> : <FileText size={16} style={{ color: 'var(--text-secondary)' }} />}
                                                  <span>{item.name}</span>
                                                </div>
                                              </td>
                                              <td>{item.type}</td>
                                              <td>{item.type === 'file' ? item.size.toLocaleString() : '-'}</td>
                                              <td>{new Date(item.modified * 1000).toLocaleString()}</td>
                                              <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                                                <button 
                                                  className="btn btn-secondary btn-sm" 
                                                  style={{ 
                                                    padding: '4px 8px', 
                                                    fontSize: '11px', 
                                                    display: 'inline-flex', 
                                                    alignItems: 'center', 
                                                    gap: '4px',
                                                    justifyContent: 'center',
                                                    minWidth: '85px'
                                                  }} 
                                                  onClick={() => handleDownloadFile(item)}
                                                  disabled={downloadingItemName === item.name}
                                                >
                                                  <Download size={12} />
                                                  {downloadingItemName === item.name ? '...' : 'Download'}
                                                </button>
                                              </td>
                                            </tr>
                                          ))
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Process Monitor Tab View */}
                            {activeTab === 'processes' && (
                              <div>
                                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                                  <div style={{ flex: 1, position: 'relative' }}>
                                    <input 
                                      type="text" 
                                      className="form-input" 
                                      style={{ width: '100%', paddingLeft: '36px' }}
                                      placeholder="Filter processes by name..."
                                      value={processSearch}
                                      onChange={e => setProcessSearch(e.target.value)}
                                    />
                                    <Search size={16} style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-muted)' }} />
                                  </div>
                                  <button className="btn btn-secondary" onClick={refreshProcessList} disabled={processLoading}>
                                    <RefreshCw size={14} /> Refresh
                                  </button>
                                </div>

                                {processLoading ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px', gap: '12px' }}>
                                    <div className="loading-spinner"></div>
                                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Gathering target system processes...</span>
                                  </div>
                                ) : (
                                  <div style={{ maxHeight: '360px', overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                                    <table className="log-table">
                                      <thead>
                                        <tr>
                                          <th style={{ width: '100px' }}>PID</th>
                                          <th>Name</th>
                                          <th style={{ width: '120px' }}>CPU %</th>
                                          <th style={{ width: '120px' }}>RAM %</th>
                                          <th style={{ width: '100px', textAlign: 'center' }}>Action</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {(Array.isArray(processList) ? processList : [])
                                          .filter(p => p && typeof p.name === 'string' && p.name.toLowerCase().includes((processSearch || '').toLowerCase()))
                                          .map((proc, idx) => (
                                            <tr key={idx}>
                                              <td style={{ fontFamily: 'var(--font-mono)' }}>{proc.pid}</td>
                                              <td style={{ fontWeight: '500' }}>{proc.name}</td>
                                              <td>{proc.cpu_percent ? `${proc.cpu_percent.toFixed(1)}%` : '0.0%'}</td>
                                              <td>{proc.memory_percent ? `${proc.memory_percent.toFixed(1)}%` : '0.0%'}</td>
                                              <td style={{ textAlign: 'center' }}>
                                                <button 
                                                  className="btn btn-danger action-btn-sm"
                                                  style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--color-danger)', border: 'none' }}
                                                  onClick={() => killProcess(proc.pid)}
                                                >
                                                  Kill
                                                </button>
                                              </td>
                                            </tr>
                                          ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Clipboard Access Tab View */}
                            {activeTab === 'clipboard' && (
                              <div className="clipboard-card">
                                <div className="metric-card" style={{ background: 'rgba(255, 255, 255, 0.01)' }}>
                                  <div className="metric-header">
                                    <span>REMOTE SYSTEM CLIPBOARD</span>
                                    <Clipboard size={16} className="metric-icon" />
                                  </div>
                                  {clipboardLoading ? (
                                    <div style={{ display: 'flex', justifyContent: 'center', padding: '24px' }}>
                                      <div className="loading-spinner"></div>
                                    </div>
                                  ) : (
                                    <textarea 
                                      className="form-input" 
                                      rows={6}
                                      readOnly
                                      style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}
                                      value={typeof remoteClipboard === 'string' ? remoteClipboard : (remoteClipboard ? JSON.stringify(remoteClipboard) : '(No clipboard content or clipboard empty)')}
                                    />
                                  )}
                                  <button className="btn btn-secondary" onClick={fetchRemoteClipboard} disabled={clipboardLoading}>
                                    Fetch Clipboard
                                  </button>
                                </div>

                                <div className="metric-card" style={{ background: 'rgba(255, 255, 255, 0.01)' }}>
                                  <div className="metric-header">
                                    <span>WRITE NEW CLIPBOARD CONTENT</span>
                                    <Clipboard size={16} className="metric-icon" />
                                  </div>
                                  <textarea 
                                    className="form-input" 
                                    rows={6}
                                    placeholder="Type content to copy to target device clipboard..."
                                    style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}
                                    value={newClipboardVal}
                                    onChange={e => setNewClipboardVal(e.target.value)}
                                    disabled={clipboardLoading}
                                  />
                                  <button className="btn btn-primary" onClick={setRemoteClipboardVal} disabled={clipboardLoading || !newClipboardVal.trim()}>
                                    Set Clipboard
                                  </button>
                                </div>
                              </div>
                            )}
                        </CollapsibleCard>
                      } />

                      {/* Route 4: Forensics Evidence */}
                      <Route path="device/:deviceId/forensics" element={
                        <div className="metrics-grid">
                          
                          {/* Screenshot Gallery */}
                          <CollapsibleCard title="Forensic Screenshot Captures" icon={ImageIcon} defaultOpen={true} style={{ gridColumn: 'span 2' }}>
                            {screenshots.length === 0 ? (
                              <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '24px' }}>
                                No screenshots captured yet. Dispatch a screenshot command above.
                              </div>
                            ) : (
                              <div className="gallery-grid">
                                {screenshots.map(s => (
                                  <div key={s.id} className="gallery-card" onClick={() => window.open(s.result_url, '_blank')}>
                                    <div className="card-action-overlay">
                                      <button 
                                        className="action-icon-btn btn-trash" 
                                        title="Delete screenshot capture"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          handleDeleteLog(s.id);
                                        }}
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                    <div className="gallery-image-wrapper">
                                      <img src={s.result_url} className="gallery-image" alt="Captured Screenshot" />
                                    </div>
                                    <div className="gallery-meta">
                                      <div className="gallery-title">Screenshot Captured</div>
                                      <div className="gallery-date">{formatDate(s.updated_at)}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </CollapsibleCard>

                          {/* Webcam Gallery */}
                          <CollapsibleCard title="Webcam Visual Evidences" icon={Camera} defaultOpen={true} style={{ gridColumn: 'span 2' }}>
                            {webcamCaptures.length === 0 ? (
                              <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '24px' }}>
                                No webcam images captured yet. Dispatch a webcam command above.
                              </div>
                            ) : (
                              <div className="gallery-grid">
                                {webcamCaptures.map(w => (
                                  <div key={w.id} className="gallery-card" onClick={() => window.open(w.result_url, '_blank')}>
                                    <div className="card-action-overlay">
                                      <button 
                                        className="action-icon-btn btn-trash" 
                                        title="Delete webcam capture"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          handleDeleteLog(w.id);
                                        }}
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                    <div className="gallery-image-wrapper">
                                      <img src={w.result_url} className="gallery-image" alt="Webcam Capture" />
                                    </div>
                                    <div className="gallery-meta">
                                      <div className="gallery-title">Webcam Snap</div>
                                      <div className="gallery-date">{formatDate(w.updated_at)}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </CollapsibleCard>

                          {/* Audio Recordings Gallery */}
                          <CollapsibleCard title="Forensic Microphone Audits" icon={Volume2} defaultOpen={true} style={{ gridColumn: 'span 2' }}>
                            {audioRecordings.length === 0 ? (
                              <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '24px' }}>
                                No voice recordings captured yet. Use the command panel to record audio.
                              </div>
                            ) : (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                                {audioRecordings.map(a => (
                                  <div key={a.id} style={{ background: '#090d16', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', position: 'relative' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                      <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--color-accent)' }}>Microphone Recording</span>
                                      <button 
                                        className="action-icon-btn btn-trash" 
                                        style={{ padding: '4px' }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          handleDeleteLog(a.id);
                                        }}
                                        title="Delete audio record"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                    
                                    <div style={{ marginBottom: '12px' }}>
                                      <audio controls src={a.result_url} style={{ width: '100%' }} />
                                    </div>
                                    
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                                      <span>Duration: {a.payload}s</span>
                                      <span>{formatDate(a.updated_at)}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </CollapsibleCard>

                          {/* USB Storage Devices Panel */}
                          <CollapsibleCard 
                            title="Detected USB Mass Storage Devices" 
                            icon={HardDrive} 
                            defaultOpen={true} 
                            style={{ gridColumn: 'span 2' }}
                            headerActions={
                              <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={handleGetUsbDevices}>
                                <RefreshCw size={12} /> Refresh USBs
                              </button>
                            }
                          >
                            {usbDevices.length === 0 ? (
                              <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '24px' }}>
                                No removable USB drives detected on device.
                              </div>
                            ) : (
                              <div style={{ overflowX: 'auto' }}>
                                <table className="log-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                                  <thead>
                                    <tr>
                                      <th style={{ textAlign: 'left', padding: '8px' }}>Drive Name</th>
                                      <th style={{ textAlign: 'left', padding: '8px' }}>Capacity</th>
                                      <th style={{ textAlign: 'left', padding: '8px' }}>Active Mountpoint</th>
                                      <th style={{ textAlign: 'center', padding: '8px', width: '120px' }}>Mount Drive</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {usbDevices.map((dev) => (
                                      <tr key={dev.name} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                        <td style={{ padding: '8px', fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>{dev.name}</td>
                                        <td style={{ padding: '8px' }}>{dev.size}</td>
                                        <td style={{ padding: '8px', color: dev.mountpoint ? 'var(--color-success)' : 'var(--text-muted)' }}>
                                          {dev.mountpoint ? dev.mountpoint : 'Not Mounted'}
                                        </td>
                                        <td style={{ padding: '8px', textAlign: 'center' }}>
                                          {dev.mountpoint ? (
                                            <button 
                                              className="btn btn-secondary" 
                                              style={{ padding: '4px 8px', fontSize: '11px' }}
                                              onClick={() => {
                                                setActiveTab('files');
                                                fetchFileList(dev.mountpoint);
                                              }}
                                            >
                                              Explore Files
                                            </button>
                                          ) : (
                                            <button 
                                              className="btn btn-primary" 
                                              style={{ padding: '4px 8px', fontSize: '11px' }}
                                              onClick={() => handleMountUsb(dev.name)}
                                            >
                                              Mount Drive
                                            </button>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            
                            {/* USB Security Event Log stream */}
                            <div style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
                              <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--color-accent)', marginBottom: '8px' }}>Removable Storage Real-Time Event Alerts:</div>
                              <div style={{ background: '#090d16', borderRadius: '4px', padding: '12px', maxHeight: '120px', overflowY: 'auto' }}>
                                {usbEvents.length === 0 ? (
                                  <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>No connection events logged since agent start.</div>
                                ) : (
                                  usbEvents.map(evt => (
                                    <div key={evt.id} style={{ fontSize: '11px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.02)', padding: '4px 0' }}>
                                      <span style={{ color: 'var(--color-warning)' }}>{evt.result_url}</span>
                                      <span style={{ color: 'var(--text-muted)' }}>{formatDate(evt.updated_at)}</span>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          </CollapsibleCard>

                        </div>
                      } />

                      {/* Route 5: Audit Log */}
                      <Route path="device/:deviceId/audit" element={
                        <CollapsibleCard title="Device Command Audit Log" icon={Activity} defaultOpen={true} contentStyle={{ padding: '0', overflowX: 'auto' }}>
                            {commands.length === 0 ? (
                              <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '32px' }}>
                                No commands issued to this device yet.
                              </div>
                            ) : (
                              <table className="log-table">
                                <thead>
                                  <tr>
                                    <th>Command ID</th>
                                    <th>Issued At</th>
                                    <th>Action</th>
                                    <th>Payload</th>
                                    <th>Status</th>
                                    <th style={{ width: '80px', textAlign: 'center' }}>Delete</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {commands.map(cmd => (
                                    <tr key={cmd.id}>
                                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
                                        {cmd.id}
                                      </td>
                                      <td>{formatDate(cmd.created_at)}</td>
                                      <td style={{ fontWeight: '600' }}>{cmd.command_type}</td>
                                      <td>{cmd.payload || <span style={{ color: 'var(--text-muted)' }}>None</span>}</td>
                                      <td>
                                        <span className={`badge badge-${cmd.status.toLowerCase()}`}>
                                          {cmd.status}
                                        </span>
                                        {cmd.error_message && (
                                          <div style={{ color: 'var(--color-danger)', fontSize: '11px', marginTop: '4px' }}>
                                            Error: {cmd.error_message}
                                          </div>
                                        )}
                                      </td>
                                      <td style={{ textAlign: 'center' }}>
                                        <button 
                                          className="action-icon-btn btn-trash" 
                                          style={{ margin: '0 auto' }} 
                                          onClick={() => handleDeleteLog(cmd.id)}
                                          title="Delete Command Log"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                        </CollapsibleCard>
                      } />

                      {/* Redirect Route */}
                      <Route path="*" element={<Navigate to={`device/${selectedDevice.id}/telemetry`} replace />} />
                    </Routes>
                  </div>
                </>
              ) : (
                <div className="center-message">
                  <button className="btn btn-primary mobile-menu-btn" style={{ marginBottom: '20px', gap: '8px', display: 'none', alignItems: 'center', justifyContent: 'center' }} onClick={() => setIsMobileSidebarOpen(true)}>
                    <Menu size={16} /> Open Devices Menu
                  </button>
                  <Monitor size={48} />
                  <h2>No Device Selected</h2>
                  <p>Select a device from the left sidebar panel or register a new one to begin remote administration.</p>
                </div>
              )}
            </div>
          </div>
        } />
      </Routes>

      {/* 3. Modals */}
      
      {/* File Content Viewer Modal */}
      {viewedFileContent !== null && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '700px' }}>
            <div className="modal-header">
              <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={18} style={{ color: 'var(--color-accent)' }} /> File Viewer: {viewedFileName}
              </span>
              <button className="close-btn" onClick={() => setViewedFileContent(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              <pre style={{ 
                background: '#04060a', 
                border: '1px solid var(--border-color)', 
                borderRadius: '8px', 
                padding: '16px', 
                maxHeight: '400px', 
                overflow: 'auto', 
                fontFamily: 'var(--font-mono)', 
                fontSize: '13px', 
                color: 'var(--text-primary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}>
                {viewedFileContent || '(Empty file)'}
              </pre>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setViewedFileContent(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Registration Command Modal */}
      {isRegModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '600px', width: '90%' }}>
            <div className="modal-header">
              <span className="modal-title">Setup / Update Linux Device</span>
              <button className="close-btn" onClick={() => setIsRegModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            
            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <button 
                  className={`btn \${regMethod === 'auto' ? 'btn-primary' : 'btn-secondary'}`} 
                  style={{ flex: 1, padding: '8px 12px', fontSize: '13px' }}
                  onClick={() => setRegMethod('auto')}
                >
                  Quick Setup (1-Step)
                </button>
                <button 
                  className={`btn \${regMethod === 'step' ? 'btn-primary' : 'btn-secondary'}`} 
                  style={{ flex: 1, padding: '8px 12px', fontSize: '13px' }}
                  onClick={() => setRegMethod('step')}
                >
                  Step-by-Step Guide
                </button>
              </div>

              {regMethod === 'auto' ? (
                <>
                  <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    To connect a new Linux device or update an existing agent quickly, run the following command in terminal:
                  </p>
                  
                  <div className="code-container">
                    <span className="code-text" style={{ wordBreak: 'break-all', fontSize: '12px' }}>
                      {`curl -fsSL "${API_BASE_URL.startsWith('http') ? API_BASE_URL : window.location.origin}/install.sh" | sudo sh -s -- --token="${localStorage.getItem('sentinel_token') || ''}" --url="${API_BASE_URL.startsWith('http') ? API_BASE_URL : window.location.origin}"`}
                    </span>
                    <button className="close-btn" style={{ color: copiedId ? 'var(--color-success)' : 'inherit' }} onClick={handleCopyCommand} title="Copy Code">
                      {copiedId ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  </div>
                  
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '12px' }}>
                    Note: This script will automate system package updates, dependency installation, device registration, and systemd service generation.
                  </p>
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '5px' }}>
                    Follow these sequential steps in your device's terminal to register and install the agent manually. This is recommended if the automated script fails due to other broken system packages.
                  </p>

                  {/* Step 1 */}
                  <div style={{ borderLeft: '2px solid var(--color-primary)', paddingLeft: '12px' }}>
                    <div style={{ fontWeight: '600', fontSize: '13px', color: 'var(--color-primary)', marginBottom: '5px' }}>
                      Step 1: Install System Dependencies
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '5px' }}>
                      Installs native system tools for display capture, audio recording, and webcam.
                    </p>
                    <div className="code-container">
                      <span className="code-text" style={{ wordBreak: 'break-all', fontSize: '12px' }}>
                        sudo apt update || true; sudo apt install -y python3 python3-pip python3-venv portaudio19-dev ffmpeg scrot
                      </span>
                      <button className="close-btn" style={{ color: copiedStep === 1 ? 'var(--color-success)' : 'inherit' }} 
                        onClick={() => handleCopyStep("sudo apt update || true; sudo apt install -y python3 python3-pip python3-venv portaudio19-dev ffmpeg scrot", 1)} title="Copy Code">
                        {copiedStep === 1 ? <Check size={16} /> : <Copy size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div style={{ borderLeft: '2px solid var(--color-primary)', paddingLeft: '12px' }}>
                    <div style={{ fontWeight: '600', fontSize: '13px', color: 'var(--color-primary)', marginBottom: '5px' }}>
                      Step 2: Register Device & Create Configuration
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '5px' }}>
                      Connects your hardware profile with your Sentinel user account using Python.
                    </p>
                    <div className="code-container">
                      <span className="code-text" style={{ wordBreak: 'break-all', fontSize: '11px', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                        {`sudo python3 -c '
import urllib.request, json, socket, uuid, os, hashlib
token = "${localStorage.getItem('sentinel_token') || ''}"
url = "${API_BASE_URL.startsWith('http') ? API_BASE_URL : window.location.origin}"
mac = ":".join(("%012X" % uuid.getnode())[i:i+2] for i in range(0, 12, 2))
dev_id = hashlib.sha256(mac.encode()).hexdigest()[:16]
req = urllib.request.Request(
    f"{url}/api/devices",
    data=json.dumps({"id": dev_id, "name": socket.gethostname(), "hostname": socket.gethostname(), "os": "Linux"}).encode(),
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
)
try:
    with urllib.request.urlopen(req) as r:
        res = json.loads(r.read().decode())
        os.makedirs("/etc/sentinel", exist_ok=True)
        with open("/etc/sentinel/agent.conf", "w") as f:
            f.write(f"BACKEND_URL={url}\\nBACKEND_WS_URL={url.replace(\"http\", \"ws\")}\\nDEVICE_ID={dev_id}\\nDEVICE_API_KEY={res[\"api_key\"]}\\nDEVICE_NAME={socket.gethostname()}\\n")
        print("[SUCCESS] Device registered and config saved to /etc/sentinel/agent.conf")
except Exception as e:
    print("[ERROR] Registration failed:", e)
'`}
                      </span>
                      <button className="close-btn" style={{ color: copiedStep === 2 ? 'var(--color-success)' : 'inherit' }} 
                        onClick={() => handleCopyStep(`sudo python3 -c '
import urllib.request, json, socket, uuid, os, hashlib
token = "${localStorage.getItem('sentinel_token') || ''}"
url = "${API_BASE_URL.startsWith('http') ? API_BASE_URL : window.location.origin}"
mac = ":".join(("%012X" % uuid.getnode())[i:i+2] for i in range(0, 12, 2))
dev_id = hashlib.sha256(mac.encode()).hexdigest()[:16]
req = urllib.request.Request(
    f"{url}/api/devices",
    data=json.dumps({"id": dev_id, "name": socket.gethostname(), "hostname": socket.gethostname(), "os": "Linux"}).encode(),
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
)
try:
    with urllib.request.urlopen(req) as r:
        res = json.loads(r.read().decode())
        os.makedirs("/etc/sentinel", exist_ok=True)
        with open("/etc/sentinel/agent.conf", "w") as f:
            f.write(f"BACKEND_URL={url}\\nBACKEND_WS_URL={url.replace(\"http\", \"ws\")}\\nDEVICE_ID={dev_id}\\nDEVICE_API_KEY={res[\"api_key\"]}\\nDEVICE_NAME={socket.gethostname()}\\n")
        print("[SUCCESS] Device registered and config saved to /etc/sentinel/agent.conf")
except Exception as e:
    print("[ERROR] Registration failed:", e)
'`, 2)} title="Copy Code">
                        {copiedStep === 2 ? <Check size={16} /> : <Copy size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div style={{ borderLeft: '2px solid var(--color-primary)', paddingLeft: '12px' }}>
                    <div style={{ fontWeight: '600', fontSize: '13px', color: 'var(--color-primary)', marginBottom: '5px' }}>
                      Step 3: Setup Virtualenv & Download Agent
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '5px' }}>
                      Downloads latest code and isolates python packages inside `/opt/sentinel`.
                    </p>
                    <div className="code-container">
                      <span className="code-text" style={{ wordBreak: 'break-all', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
                        {`sudo mkdir -p /opt/sentinel && cd /opt/sentinel && \\
sudo python3 -m venv venv && \\
sudo curl -s -o requirements.txt "${API_BASE_URL.startsWith('http') ? API_BASE_URL : window.location.origin}/requirements.txt" && \\
sudo curl -s -o agent.py "${API_BASE_URL.startsWith('http') ? API_BASE_URL : window.location.origin}/agent.py" && \\
sudo ./venv/bin/pip3 install --upgrade pip && \\
sudo ./venv/bin/pip3 install -r requirements.txt`}
                      </span>
                      <button className="close-btn" style={{ color: copiedStep === 3 ? 'var(--color-success)' : 'inherit' }} 
                        onClick={() => handleCopyStep(`sudo mkdir -p /opt/sentinel && cd /opt/sentinel && sudo python3 -m venv venv && sudo curl -s -o requirements.txt "${API_BASE_URL.startsWith('http') ? API_BASE_URL : window.location.origin}/requirements.txt" && sudo curl -s -o agent.py "${API_BASE_URL.startsWith('http') ? API_BASE_URL : window.location.origin}/agent.py" && sudo ./venv/bin/pip3 install --upgrade pip && sudo ./venv/bin/pip3 install -r requirements.txt`, 3)} title="Copy Code">
                        {copiedStep === 3 ? <Check size={16} /> : <Copy size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div style={{ borderLeft: '2px solid var(--color-primary)', paddingLeft: '12px' }}>
                    <div style={{ fontWeight: '600', fontSize: '13px', color: 'var(--color-primary)', marginBottom: '5px' }}>
                      Step 4: Configure Daemon & Run Service
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '5px' }}>
                      Registers the agent as a background systemd service to run automatically on system boot.
                    </p>
                    <div className="code-container">
                      <span className="code-text" style={{ wordBreak: 'break-all', fontSize: '11px', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                        {`sudo tee /etc/systemd/system/sentinel-agent.service > /dev/null <<EOF
[Unit]
Description=Sentinel Device Remote Administration Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sentinel
Environment=SENTINEL_CONFIG_PATH=/etc/sentinel/agent.conf
ExecStart=/opt/sentinel/venv/bin/python3 /opt/sentinel/agent.py
Restart=always
RestartSec=5
RestartPreventExitStatus=99

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable sentinel-agent
sudo systemctl restart sentinel-agent`}
                      </span>
                      <button className="close-btn" style={{ color: copiedStep === 4 ? 'var(--color-success)' : 'inherit' }} 
                        onClick={() => handleCopyStep(`sudo tee /etc/systemd/system/sentinel-agent.service > /dev/null <<EOF
[Unit]
Description=Sentinel Device Remote Administration Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sentinel
Environment=SENTINEL_CONFIG_PATH=/etc/sentinel/agent.conf
ExecStart=/opt/sentinel/venv/bin/python3 /opt/sentinel/agent.py
Restart=always
RestartSec=5
RestartPreventExitStatus=99

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable sentinel-agent
sudo systemctl restart sentinel-agent`, 4)} title="Copy Code">
                        {copiedStep === 4 ? <Check size={16} /> : <Copy size={16} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setIsRegModalOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Display Custom Notification message Modal */}
      {isMsgModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <span className="modal-title">Display Remote Message Warning</span>
              <button className="close-btn" onClick={() => setIsMsgModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Warning Alert Message</label>
                <textarea 
                  className="form-input" 
                  rows={4} 
                  required 
                  placeholder="E.g., WARNING: This device has been reported stolen. Your location is being monitored."
                  value={customMsg}
                  onChange={e => setCustomMsg(e.target.value)}
                  style={{ resize: 'vertical' }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setIsMsgModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={sendCustomMessage}>Send Message</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm critical action (Shutdown/Restart) Modal */}
      {isConfirmModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header" style={{ borderBottomColor: 'rgba(239, 68, 68, 0.2)' }}>
              <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-danger)' }}>
                <AlertTriangle size={18} /> Confirm Critical Action
              </span>
              <button className="close-btn" onClick={() => setIsConfirmModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '14px', lineHeight: '1.5' }}>
                Are you absolutely sure you want to dispatch a <strong>{confirmCmdType}</strong> command to <strong>{selectedDevice?.name}</strong>?
              </p>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                This will trigger an immediate hard {confirmCmdType === 'SHUTDOWN' ? 'power off' : 'reboot'} of the target machine, which could cause unsaved work to be lost.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setIsConfirmModalOpen(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={sendConfirmCommand}>Confirm {confirmCmdType}</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Unregister Device Modal */}
      {isUnregisterModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header" style={{ borderBottomColor: 'rgba(239, 68, 68, 0.2)' }}>
              <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-danger)' }}>
                <AlertTriangle size={18} /> Confirm Unregister Device
              </span>
              <button className="close-btn" onClick={() => setIsUnregisterModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '14px', lineHeight: '1.5' }}>
                Are you absolutely sure you want to unregister and permanently delete <strong>{selectedDevice?.name}</strong>?
              </p>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                This action is irreversible. All command history, forensic images, audio files, and telemetry logs associated with this device will be deleted from the database.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setIsUnregisterModalOpen(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleUnregisterDevice}>Confirm Unregister</button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}

export default App;
