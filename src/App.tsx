/**
 * Application root. Owns the render loop:
 *
 *   each animation frame:
 *     SimClock.tick(dt)               advance simulated time
 *     PropagationEngine.update()      issue SGP4 jobs to idle workers
 *     GlobeScene.frame()              GMST rotation, time uniform, render
 *
 * Worker replies flow engine.onSlice → scene.applySlice → GPU buffers.
 * React only handles UI state (clock display at 4 Hz, selection, filters);
 * it never touches per-object data.
 */

import { useEffect, useRef, useState } from 'react';
import { loadCatalog, MissingApiKeyError } from './api/keeptrack';
import {
  buildCatalog,
  computeVisibility,
  DEFAULT_FILTERS,
  type Catalog,
  type FilterState,
  type SatMeta,
} from './data/catalog';
import { GlobeScene, type OverlayKind } from './engine/GlobeScene';
import type { ChartStyle } from './engine/mythos/overlays';
import { PropagationEngine } from './engine/PropagationEngine';
import { SimClock } from './engine/SimClock';
import { SelectedSat, type LiveState } from './engine/selection';
import { TimeControls } from './components/TimeControls';
import { SearchBar } from './components/SearchBar';
import { FilterPanel } from './components/FilterPanel';
import { DetailPanel } from './components/DetailPanel';
import { ChartPanel } from './components/ChartPanel';
import { Credits } from './components/Credits';
import { ApiKeySetup } from './components/ApiKeySetup';

/**
 * Object colours per chart style. The mythos set trades the cool screen
 * palette for inks that hold up against parchment.
 */
const TYPE_COLORS: Record<ChartStyle, Record<number, [number, number, number]>> = {
  modern: {
    1: [0.31, 0.86, 1.0],
    2: [1.0, 0.72, 0.3],
    3: [0.62, 0.62, 0.66],
    0: [0.81, 0.58, 0.92],
  },
  mythos: {
    1: [1.0, 0.85, 0.42],
    2: [0.95, 0.42, 0.18],
    3: [0.46, 0.34, 0.2],
    0: [0.6, 0.38, 0.72],
  },
};

const UI_SYNC_MS = 250;
const CLICK_DRAG_THRESHOLD_PX = 5;
const STYLE_KEY = 'upthere.chartStyle';

function storedStyle(): ChartStyle {
  return localStorage.getItem(STYLE_KEY) === 'mythos' ? 'mythos' : 'modern';
}

/** Per-object colour buffer for a style, indexed by catalog position. */
function paletteFor(cat: Catalog, style: ChartStyle): Float32Array {
  const table = TYPE_COLORS[style];
  const colors = new Float32Array(cat.sats.length * 3);
  for (const s of cat.sats) colors.set(table[s.type] ?? table[0], s.index * 3);
  return colors;
}

interface SimInfo {
  simMs: number;
  speed: number;
  playing: boolean;
  fps: number;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const sceneRef = useRef<GlobeScene | null>(null);
  const engineRef = useRef<PropagationEngine | null>(null);
  const clockRef = useRef(new SimClock());
  const catalogRef = useRef<Catalog | null>(null);
  const visMaskRef = useRef<Uint8Array>(new Uint8Array(0));
  const selectedRef = useRef<{ meta: SatMeta; sat: SelectedSat; orbitAtMs: number } | null>(null);

  const [status, setStatus] = useState('initializing…');
  const [ready, setReady] = useState(false);
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [shown, setShown] = useState(0);
  const [selected, setSelected] = useState<SatMeta | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [chartStyle, setChartStyle] = useState<ChartStyle>(storedStyle);
  const [overlay, setOverlay] = useState<OverlayKind>('none');
  // The catalog can arrive long after mount; the render loop reads the
  // style through a ref so the first colour upload is never stale.
  const styleRef = useRef(chartStyle);
  styleRef.current = chartStyle;
  const [simInfo, setSimInfo] = useState<SimInfo>({
    simMs: Date.now(),
    speed: 1,
    playing: true,
    fps: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const scene = new GlobeScene(canvas);
    const engine = new PropagationEngine();
    const clock = clockRef.current;
    sceneRef.current = scene;
    engineRef.current = engine;
    scene.setEngine(engine);
    engine.onSlice = (u) => scene.applySlice(u);

    let raf = 0;
    let disposed = false;
    let lastT = performance.now();
    let frames = 0;
    let lastUiSync = 0;

    (async () => {
      try {
        const { sats } = await loadCatalog(setStatus);
        if (disposed) return;
        setStatus('parsing TLEs…');
        const cat = buildCatalog(sats);
        catalogRef.current = cat;
        setCatalog(cat);

        scene.initPoints(cat.sats.length, paletteFor(cat, styleRef.current));

        visMaskRef.current = computeVisibility(cat, DEFAULT_FILTERS);
        setShown(cat.sats.length);

        setStatus(`propagating ${cat.sats.length.toLocaleString()} objects…`);
        engine.onReady = () => {
          setReady(true);
          setStatus('');
        };
        engine.init(cat.tles);
      } catch (err) {
        if (err instanceof MissingApiKeyError) {
          setNeedsApiKey(true);
          setStatus('');
        } else {
          setStatus(`failed to load catalog: ${(err as Error).message}`);
        }
      }
    })();

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      // dt is intentionally unclamped: after tab throttling the sim time
      // must catch up to real time in one jump.
      const dt = t - lastT;
      lastT = t;
      frames++;

      clock.tick(dt);
      const simMs = clock.simMs;
      engineRef.current?.update(simMs, clock.playing ? clock.speed : 0);

      const sel = selectedRef.current;
      if (sel) {
        const st = sel.sat.live(simMs);
        scene.setSelectedMarker(st ? st.eci : null);
        const periodMs = sel.meta.periodMin * 60000;
        if (Math.abs(simMs - sel.orbitAtMs) > periodMs / 2) {
          sel.orbitAtMs = simMs;
          const g = sel.sat.orbitGeometry(simMs, sel.meta.periodMin);
          scene.setOrbitPath(g.eci);
          scene.setGroundTrack(g.ecef);
        }
      }

      scene.frame(simMs, engineRef.current?.refMs ?? simMs);

      if (t - lastUiSync > UI_SYNC_MS) {
        setSimInfo({
          simMs,
          speed: clock.speed,
          playing: clock.playing,
          fps: Math.round((frames * 1000) / Math.max(1, t - lastUiSync)),
        });
        frames = 0;
        lastUiSync = t;
        if (sel) setLive(sel.sat.live(simMs));
      }
    };
    raf = requestAnimationFrame(loop);

    let downX = 0;
    let downY = 0;
    const onDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_DRAG_THRESHOLD_PX) return;
      const idx = scene.pick(e.clientX, e.clientY, visMaskRef.current, clock.simMs);
      const cat = catalogRef.current;
      if (idx !== null && cat) selectSat(cat.sats[idx]);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);

    const onResize = () => scene.resize();
    window.addEventListener('resize', onResize);
    onResize();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      window.removeEventListener('resize', onResize);
      engine.dispose();
      scene.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const cat = catalogRef.current;
    if (!cat) return;
    const mask = computeVisibility(cat, filters);
    visMaskRef.current = mask;
    sceneRef.current?.setVisibility(mask);
    let n = 0;
    for (let i = 0; i < mask.length; i++) n += mask[i];
    setShown(n);
  }, [filters, catalog]);

  useEffect(() => {
    localStorage.setItem(STYLE_KEY, chartStyle);
    sceneRef.current?.setChartStyle(chartStyle);
    const cat = catalogRef.current;
    if (cat) sceneRef.current?.setPointColors(paletteFor(cat, chartStyle));
  }, [chartStyle, catalog]);

  useEffect(() => {
    sceneRef.current?.setOverlay(overlay);
  }, [overlay]);

  function selectSat(meta: SatMeta) {
    const cat = catalogRef.current;
    if (!cat) return;
    const tle1 = cat.tles[meta.index * 2];
    const tle2 = cat.tles[meta.index * 2 + 1];
    try {
      const sat = new SelectedSat(tle1, tle2);
      const simMs = clockRef.current.simMs;
      selectedRef.current = { meta, sat, orbitAtMs: simMs };
      const g = sat.orbitGeometry(simMs, meta.periodMin);
      sceneRef.current?.setOrbitPath(g.eci);
      sceneRef.current?.setGroundTrack(g.ecef);
      setSelected(meta);
      setLive(sat.live(simMs));
    } catch {
      selectedRef.current = null;
      setSelected(meta);
      setLive(null);
    }
  }

  function clearSelection() {
    selectedRef.current = null;
    setSelected(null);
    setLive(null);
    sceneRef.current?.setOrbitPath(null);
    sceneRef.current?.setGroundTrack(null);
    sceneRef.current?.setSelectedMarker(null);
  }

  const clock = clockRef.current;

  return (
    <div className={`app${chartStyle === 'mythos' ? ' theme-mythos' : ''}`}>
      <canvas ref={canvasRef} className="globe-canvas" />

      <div className="top-bar">
        <div className="brand">
          <span className="brand-name">UpThere</span>
          <span className="brand-sub">live orbit tracker</span>
        </div>
        <SearchBar catalog={catalog} onSelect={selectSat} />
        <div className="fps">{simInfo.fps} fps</div>
      </div>

      {catalog && (
        <FilterPanel
          filters={filters}
          countries={catalog.countries}
          shown={shown}
          total={catalog.sats.length}
          onChange={setFilters}
        />
      )}

      <ChartPanel
        style={chartStyle}
        overlay={overlay}
        onStyle={setChartStyle}
        onOverlay={setOverlay}
      />

      <Credits style={chartStyle} />

      {selected && <DetailPanel sat={selected} live={live} onClose={clearSelection} />}

      <TimeControls
        simMs={simInfo.simMs}
        speed={simInfo.speed}
        playing={simInfo.playing}
        onSpeed={(s) => {
          clock.setSpeed(s);
          clock.playing = true;
        }}
        onPlayPause={() => (clock.playing = !clock.playing)}
        onNow={() => clock.resetToNow()}
        onJump={(d) => clock.jump(d)}
      />

      {needsApiKey && <ApiKeySetup />}

      {!ready && !needsApiKey && (
        <div className="loading-overlay">
          <div className="loading-box panel">
            <div className="spinner" />
            <div>{status || 'starting…'}</div>
          </div>
        </div>
      )}
    </div>
  );
}
