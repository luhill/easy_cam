import { useState } from 'react';
import { OperationPalette } from './FileUpload';
import { PartSetup } from './PartSetup';
import { OperationList } from './Operations/OperationList';
import { ToolOriginSettings } from './ToolOriginSettings';
import { GlobalCamSettings } from './GlobalCamSettings';
import { ViewportSettings } from './ViewportSettings';
import { GcodeSettings } from './GcodeSettings';
import { OperationsTabFooter } from './OperationsTabFooter';

type SidebarTab = 'part' | 'operations' | 'settings';

const TABS: { id: SidebarTab; label: string; title: string }[] = [
  { id: 'part', label: 'Part', title: 'Part setup' },
  { id: 'operations', label: 'Ops', title: 'Operations' },
  { id: 'settings', label: 'Settings', title: 'Settings' },
];

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('operations');

  return (
    <aside className="sidebar">
      <nav className="sidebar-tabs" aria-label="Sidebar sections">
        {TABS.map(({ id, label, title }) => (
          <button
            key={id}
            type="button"
            className={`sidebar-tab ${activeTab === id ? 'active' : ''}`}
            onClick={() => setActiveTab(id)}
            title={title}
            aria-current={activeTab === id ? 'page' : undefined}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="sidebar-panel">
        <div className="sidebar-panel-body">
          {activeTab === 'part' && (
            <div className="sidebar-tab-content">
              <PartSetup />
            </div>
          )}

          {activeTab === 'operations' && (
            <div className="sidebar-tab-content sidebar-tab-content--operations">
              <OperationPalette />
              <OperationList />
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="sidebar-tab-content sidebar-tab-content--settings">
              <ToolOriginSettings />
              <GlobalCamSettings />
              <ViewportSettings />
              <GcodeSettings />
            </div>
          )}
        </div>
        <OperationsTabFooter />
      </div>
    </aside>
  );
}
