import type { SatMeta } from '../data/catalog';
import type { LiveState } from '../engine/selection';
import { TYPE_LABELS } from './labels';

interface Props {
  sat: SatMeta;
  live: LiveState | null;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  );
}

export function DetailPanel({ sat, live, onClose }: Props) {
  return (
    <div className="detail-panel panel">
      <div className="detail-header">
        <div>
          <span className={`type-dot t${sat.type}`} />
          <span className="detail-name">{sat.name}</span>
        </div>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>
      <div className="detail-sub">
        #{sat.noradId} · {TYPE_LABELS[sat.type]} · {sat.regime} · {sat.country}
        {sat.launchDate ? ` · launched ${sat.launchDate.slice(0, 10)}` : ''}
      </div>

      {live && (
        <div className="detail-section">
          <div className="filter-title">Live</div>
          <Row label="Latitude" value={`${live.latDeg.toFixed(3)}°`} />
          <Row label="Longitude" value={`${live.lonDeg.toFixed(3)}°`} />
          <Row label="Altitude" value={`${live.altKm.toFixed(1)} km`} />
          <Row label="Speed" value={`${live.speedKmS.toFixed(2)} km/s`} />
        </div>
      )}

      <div className="detail-section">
        <div className="filter-title">Orbit</div>
        <Row label="Inclination" value={`${sat.inclinationDeg.toFixed(2)}°`} />
        <Row label="Eccentricity" value={sat.eccentricity.toFixed(5)} />
        <Row label="Period" value={`${sat.periodMin.toFixed(1)} min`} />
        <Row label="Apogee" value={`${Math.round(sat.apogeeKm).toLocaleString()} km`} />
        <Row label="Perigee" value={`${Math.round(sat.perigeeKm).toLocaleString()} km`} />
        <Row label="RAAN" value={`${sat.raanDeg.toFixed(2)}°`} />
        <Row label="Mean motion" value={`${sat.meanMotion.toFixed(4)} rev/day`} />
      </div>
      <div className="detail-hint">White line = orbit (ECI) · yellow = ground track</div>
    </div>
  );
}
