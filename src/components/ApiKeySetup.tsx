import { useState } from 'react';
import { saveApiKey } from '../api/keeptrack';

export function ApiKeySetup() {
  const [key, setKey] = useState('');

  const submit = () => {
    if (!key.trim()) return;
    saveApiKey(key);
    window.location.reload();
  };

  return (
    <div className="loading-overlay key-setup">
      <div className="key-box panel">
        <h2>KeepTrack API key required</h2>
        <p>
          UpThere pulls its satellite catalog from the KeepTrack API. Get a free key at{' '}
          <a href="https://api.keeptrack.space" target="_blank" rel="noreferrer">
            api.keeptrack.space
          </a>{' '}
          and paste it below. It is stored only on this device.
        </p>
        <div className="key-row">
          <input
            type="password"
            placeholder="kt_…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            spellCheck={false}
            autoFocus
          />
          <button onClick={submit} disabled={!key.trim()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
