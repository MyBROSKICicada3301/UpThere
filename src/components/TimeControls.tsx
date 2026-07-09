const SPEEDS = [-1000, -100, -10, -1, 1, 10, 100, 1000];

interface Props {
  simMs: number;
  speed: number;
  playing: boolean;
  onSpeed: (s: number) => void;
  onPlayPause: () => void;
  onNow: () => void;
  onJump: (deltaMs: number) => void;
}

export function TimeControls({ simMs, speed, playing, onSpeed, onPlayPause, onNow, onJump }: Props) {
  const d = new Date(simMs);
  const offsetMin = Math.round((simMs - Date.now()) / 60000);
  return (
    <div className="time-controls panel">
      <div className="time-display">
        <span className="time-utc">{d.toISOString().replace('T', ' ').slice(0, 19)} UTC</span>
        {Math.abs(offsetMin) > 1 && (
          <span className="time-offset">
            {offsetMin > 0 ? '+' : ''}
            {Math.abs(offsetMin) > 5940 ? `${(offsetMin / 1440).toFixed(1)} d` : `${offsetMin} min`}
          </span>
        )}
      </div>
      <div className="time-buttons">
        <button onClick={() => onJump(-86400_000)} title="Back 1 day">−1d</button>
        <button onClick={() => onJump(-3600_000)} title="Back 1 hour">−1h</button>
        <button className="play-btn" onClick={onPlayPause}>{playing ? '⏸' : '▶'}</button>
        <button onClick={() => onJump(3600_000)} title="Forward 1 hour">+1h</button>
        <button onClick={() => onJump(86400_000)} title="Forward 1 day">+1d</button>
        <button onClick={onNow} title="Reset to real time">Now</button>
      </div>
      <div className="speed-buttons">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={s === speed ? 'active' : ''}
            onClick={() => onSpeed(s)}
          >
            {s > 0 ? `${s}×` : `${s}×`}
          </button>
        ))}
      </div>
    </div>
  );
}
