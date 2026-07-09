import { useState } from 'react';
import type { Catalog, SatMeta } from '../data/catalog';
import { searchCatalog } from '../data/catalog';
import { TYPE_LABELS } from './labels';

interface Props {
  catalog: Catalog | null;
  onSelect: (sat: SatMeta) => void;
}

export function SearchBar({ catalog, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const results = catalog && query ? searchCatalog(catalog, query) : [];

  return (
    <div className="search-bar">
      <input
        type="text"
        placeholder="Search name or NORAD ID…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
      />
      {results.length > 0 && (
        <ul className="search-results panel">
          {results.map((s) => (
            <li
              key={s.index}
              onClick={() => {
                onSelect(s);
                setQuery('');
              }}
            >
              <span className={`type-dot t${s.type}`} />
              <span className="result-name">{s.name}</span>
              <span className="result-meta">
                #{s.noradId} · {TYPE_LABELS[s.type]} · {s.regime}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
