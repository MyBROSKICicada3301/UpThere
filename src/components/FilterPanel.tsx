import type { FilterState, Regime } from '../data/catalog';
import { TYPE_LABELS, REGIMES } from './labels';

interface Props {
  filters: FilterState;
  countries: string[];
  shown: number;
  total: number;
  onChange: (f: FilterState) => void;
}

export function FilterPanel({ filters, countries, shown, total, onChange }: Props) {
  const toggleType = (t: number) => {
    const types = new Set(filters.types);
    types.has(t) ? types.delete(t) : types.add(t);
    onChange({ ...filters, types });
  };
  const toggleRegime = (r: Regime) => {
    const regimes = new Set(filters.regimes);
    regimes.has(r) ? regimes.delete(r) : regimes.add(r);
    onChange({ ...filters, regimes });
  };

  return (
    <div className="filter-panel panel">
      <div className="filter-count">
        {shown.toLocaleString()} / {total.toLocaleString()} objects
      </div>

      <div className="filter-section">
        <div className="filter-title">Type</div>
        {[1, 2, 3, 0].map((t) => (
          <label key={t}>
            <input type="checkbox" checked={filters.types.has(t)} onChange={() => toggleType(t)} />
            <span className={`type-dot t${t}`} />
            {TYPE_LABELS[t]}
          </label>
        ))}
      </div>

      <div className="filter-section">
        <div className="filter-title">Orbit</div>
        {REGIMES.map((r) => (
          <label key={r}>
            <input
              type="checkbox"
              checked={filters.regimes.has(r)}
              onChange={() => toggleRegime(r)}
            />
            {r}
          </label>
        ))}
      </div>

      <div className="filter-section">
        <div className="filter-title">Country</div>
        <select
          value={filters.country}
          onChange={(e) => onChange({ ...filters, country: e.target.value })}
        >
          <option value="ALL">All</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-section">
        <div className="filter-title">Altitude (km)</div>
        <div className="alt-inputs">
          <input
            type="number"
            value={filters.altMinKm}
            min={0}
            onChange={(e) => onChange({ ...filters, altMinKm: Number(e.target.value) || 0 })}
          />
          <span>–</span>
          <input
            type="number"
            value={filters.altMaxKm}
            onChange={(e) => onChange({ ...filters, altMaxKm: Number(e.target.value) || 0 })}
          />
        </div>
      </div>
    </div>
  );
}
