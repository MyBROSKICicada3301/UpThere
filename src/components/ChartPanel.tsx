import type { OverlayKind } from '../engine/GlobeScene';
import type { ChartStyle } from '../engine/mythos/overlays';

interface Props {
  style: ChartStyle;
  overlay: OverlayKind;
  onStyle: (s: ChartStyle) => void;
  onOverlay: (o: OverlayKind) => void;
}

const STYLES: [ChartStyle, string, string][] = [
  ['modern', 'Modern', 'Photographic day/night globe'],
  ['mythos', 'Mythos', 'Hand-drawn chart of the old world'],
];

const OVERLAYS: [OverlayKind, string, string][] = [
  ['none', 'None', ''],
  ['winds', 'Winds', 'The eight Anemoi over the trade, westerly and polar belts.'],
  ['currents', 'Seas', 'The five great gyres and the Antarctic Circumpolar.'],
];

export function ChartPanel({ style, overlay, onStyle, onOverlay }: Props) {
  const caption = OVERLAYS.find((o) => o[0] === overlay)?.[2];

  return (
    <div className="chart-panel panel">
      <div className="filter-title">Chart</div>
      <div className="tab-row">
        {STYLES.map(([id, label, hint]) => (
          <button
            key={id}
            className={id === style ? 'active' : ''}
            onClick={() => onStyle(id)}
            title={hint}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="filter-title">Overlay</div>
      <div className="tab-row">
        {OVERLAYS.map(([id, label]) => (
          <button key={id} className={id === overlay ? 'active' : ''} onClick={() => onOverlay(id)}>
            {label}
          </button>
        ))}
      </div>

      {caption && <div className="chart-caption">{caption}</div>}
    </div>
  );
}
