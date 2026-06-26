// 应用外壳：左侧栏 + 主区 + 连接表单模态 + 设置模态。
import { useState } from "react";
import { ConnectionsProvider, useConnections } from "./hooks/useConnections";
import { GroupsProvider } from "./hooks/useGroups";
import { I18nProvider } from "./i18n";
import { SettingsProvider } from "./settings";
import { Sidebar } from "./components/Sidebar";
import { MainPane } from "./components/MainPane";
import { ConnectionForm } from "./components/ConnectionForm";
import { SettingsModal } from "./components/SettingsModal";
import type { ConnectionConfig } from "./types";

type EditState =
  | { mode: "new" }
  | { mode: "edit"; config: ConnectionConfig }
  | null;

function Shell() {
  const { save } = useConnections();
  const [edit, setEdit] = useState<EditState>(null);
  const [showSettings, setShowSettings] = useState(false);

  async function handleSave(config: ConnectionConfig) {
    await save(config);
    setEdit(null);
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100">
      <Sidebar
        onNew={() => setEdit({ mode: "new" })}
        onEdit={(c) => setEdit({ mode: "edit", config: c })}
        onSettings={() => setShowSettings(true)}
      />
      <MainPane />
      {edit && (
        <ConnectionForm
          initial={edit.mode === "edit" ? edit.config : null}
          onSave={handleSave}
          onCancel={() => setEdit(null)}
        />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <SettingsProvider>
        <ConnectionsProvider>
          <GroupsProvider>
            <Shell />
          </GroupsProvider>
        </ConnectionsProvider>
      </SettingsProvider>
    </I18nProvider>
  );
}
