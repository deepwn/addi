import React, { useEffect } from "react";
import { useVscodeMessage, postMessage } from "./hooks/useVscode";
import { ProviderForm } from "./components/ProviderForm";
import { ModelForm } from "./components/ModelForm";
import { I18nProvider, detectLocale, useT } from "./i18n";
import type { Locale } from "./i18n";
import type { WebviewUpdateMessage, ByokModelDefaultSettings, RemoteModelInfo, ByokProviderFormData, ByokModelFormData } from "./types";
import "./index.css";

/** Inner component that consumes i18n context and renders the appropriate form */
const AppInner: React.FC = () => {
  const t = useT();
  const updatePayload = useVscodeMessage("update");

  useEffect(() => {
    postMessage("ready");
  }, []);

  if (!updatePayload) {
    return (
      <div
        className="container"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          opacity: 0.5,
        }}
      >
        <p>{t("app.noSelection")}</p>
      </div>
    );
  }

  const msg = updatePayload as WebviewUpdateMessage;
  const { item, mode } = msg;

  if (!item || !item.data) {
    return null;
  }

  // 'create' maps to 'edit' for the form components (both allow editing)
  const formMode = mode === "create" ? "edit" : mode;

  return (
    <div className="container" style={{ display: "flex", gap: "20px" }}>
      <div className="left-col" style={{ flex: 1, minWidth: "300px" }}>
        {item.type === "provider" && !item.isBatchMode && (
          <ProviderForm data={item.data as ByokProviderFormData} mode={formMode} isCreate={mode === "create"} />
        )}
        {item.type === "model" && (
          <ModelForm
            data={item.data as ByokModelFormData}
            mode={formMode}
            parentId={item.parentId}
            isBatchMode={item.isBatchMode}
            batchCount={item.batchCount}
            providerDefaults={
              (item.data as unknown as Record<string, unknown>)["providerDefaults"] as
                ByokModelDefaultSettings | undefined
            }
            remoteModels={
              (item.data as unknown as Record<string, unknown>)["remoteModels"] as
                RemoteModelInfo[] | undefined
            }
          />
        )}
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  const updatePayload = useVscodeMessage("update");
  const locale: Locale = updatePayload
    ? detectLocale((updatePayload as WebviewUpdateMessage).locale)
    : detectLocale(navigator.language);

  return (
    <I18nProvider locale={locale}>
      <AppInner />
    </I18nProvider>
  );
};

export default App;
