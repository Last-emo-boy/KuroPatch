interface LabProps {
  onOpenHooks?: () => void;
  onOpenFlows?: () => void;
  onOpenSessions?: () => void;
}

const LAB_ITEMS = [
  {
    title: 'Hooks',
    desc: 'Runtime event feed for fetch, xhr, errors, console, and DOM mutations.',
    cta: 'Open Hooks',
    actionKey: 'hooks',
  },
  {
    title: 'Flows',
    desc: 'Automation builder for repeatable multi-step experiments and future task templates.',
    cta: 'Open Flows',
    actionKey: 'flows',
  },
  {
    title: 'Sessions',
    desc: 'Debug snapshots and notes that still need clearer product semantics before graduating.',
    cta: 'Open Sessions',
    actionKey: 'sessions',
  },
] as const;

export default function Lab({ onOpenHooks, onOpenFlows, onOpenSessions }: LabProps) {
  const open = (key: typeof LAB_ITEMS[number]['actionKey']) => {
    if (key === 'hooks') onOpenHooks?.();
    if (key === 'flows') onOpenFlows?.();
    if (key === 'sessions') onOpenSessions?.();
  };

  return (
    <div className="product-pane lab-page">
      <div className="product-pane-header">
        <div>
          <span className="page-hub-kicker">Lab</span>
          <h3 style={{ margin: 0 }}>Advanced and experimental tools</h3>
        </div>
      </div>

      <div className="card lab-intro-card">
        <p>
          Lab keeps fast-moving capabilities out of the default daily workflow. These tools are useful,
          but they still need more polish before they belong in the main product surface.
        </p>
      </div>

      <div className="lab-grid">
        {LAB_ITEMS.map((item) => (
          <button key={item.title} className="lab-card" onClick={() => open(item.actionKey)}>
            <div className="lab-card-top">
              <span className="badge warning">Experimental</span>
              <span className="lab-card-arrow">→</span>
            </div>
            <div className="lab-card-title">{item.title}</div>
            <div className="lab-card-desc">{item.desc}</div>
            <div className="lab-card-cta">{item.cta}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
