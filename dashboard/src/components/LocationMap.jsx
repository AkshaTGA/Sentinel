import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';

// Fix Leaflet default marker icon resolution in bundlers
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

L.Marker.prototype.options.icon = DefaultIcon;

// Helper component to center Leaflet map on coordinate changes
function ChangeMapCenter({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center && center[0] && center[1]) {
      map.setView(center, 13);
    }
  }, [center, map]);
  return null;
}

const formatUptime = (seconds) => {
  if (!seconds) return 'N/A';
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  
  let res = '';
  if (d > 0) res += `${d}d `;
  if (h > 0) res += `${h}h `;
  res += `${m}m`;
  return res;
};

export default function LocationMap({ locationCenter, selectedDevice, latestTelemetry }) {
  if (!locationCenter) {
    return (
      <div className="section-content">
        <div className="map-placeholder">
          <MapPin size={32} />
          <div>No location telemetry received from device yet.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="map-container">
      <MapContainer 
        center={locationCenter} 
        zoom={13} 
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={locationCenter}>
          <Popup>
            <strong>{selectedDevice?.name || 'Device'}</strong><br />
            Uptime: {formatUptime(latestTelemetry?.uptime)}<br />
            IP: {latestTelemetry?.public_ip || 'N/A'}
          </Popup>
        </Marker>
        <ChangeMapCenter center={locationCenter} />
      </MapContainer>
    </div>
  );
}
