import { useState } from 'react';
import Chat from './components/Chat';
import Settings from './components/Settings';
import Scripts from './components/Scripts';
import Inspect from './components/Inspect';
import Network from './components/Network';
import Hooks from './components/Hooks';
import Patches from './components/Patches';
import Flows from './components/Flows';
import Sessions from './components/Sessions';

type View = 'chat' | 'settings' | 'scripts' | 'inspect' | 'network' | 'hooks' | 'patches' | 'flows' | 'sessions';

export default function App() {
  const [view, setView] = useState<View>('chat');
  const goChat = () => setView('chat');

  return (
    <div className="app">
      {view === 'settings' ? (
        <div style={{ height: '100%', overflow: 'auto', padding: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <button className="btn secondary" onClick={goChat} style={{ padding: '4px 10px', fontSize: 11 }}>← Back to Chat</button>
            <h3 style={{ margin: 0 }}>Settings</h3>
          </div>
          <Settings />
        </div>
      ) : view === 'scripts' ? (
        <Scripts onBack={goChat} />
      ) : view === 'inspect' ? (
        <Inspect onBack={goChat} />
      ) : view === 'network' ? (
        <div style={{ height: '100%', overflow: 'auto' }}>
          <Network onBack={goChat} />
        </div>
      ) : view === 'hooks' ? (
        <div style={{ height: '100%', overflow: 'auto' }}>
          <Hooks onBack={goChat} />
        </div>
      ) : view === 'patches' ? (
        <div style={{ height: '100%', overflow: 'auto' }}>
          <Patches onBack={goChat} />
        </div>
      ) : view === 'flows' ? (
        <div style={{ height: '100%', overflow: 'auto' }}>
          <Flows onBack={goChat} />
        </div>
      ) : view === 'sessions' ? (
        <div style={{ height: '100%', overflow: 'auto' }}>
          <Sessions onBack={goChat} />
        </div>
      ) : (
        <Chat
          onOpenSettings={() => setView('settings')}
          onOpenScripts={() => setView('scripts')}
          onOpenPanel={setView as (v: string) => void}
        />
      )}
    </div>
  );
}
