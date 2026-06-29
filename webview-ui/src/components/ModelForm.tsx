import React, { useState, useEffect, useMemo } from "react";
import type { ByokModelFormData, ByokModelDefaultSettings, RemoteModelInfo } from "../types";
import { postMessage } from "../hooks/useVscode";
import { useLocale } from "../i18n";

interface ModelFormProps {
  data: ByokModelFormData & { parentProviderName?: string };
  mode: "edit" | "read";
  parentId?: string;
  isBatchMode?: boolean;
  batchCount?: number;
  providerDefaults?: ByokModelDefaultSettings;
  remoteModels?: RemoteModelInfo[];
}

export const ModelForm: React.FC<ModelFormProps> = ({
  data,
  mode,
  parentId,
  isBatchMode,
  batchCount,
  providerDefaults,
  remoteModels,
}) => {
  const { t } = useLocale();
  const [formData, setFormData] = useState<ByokModelFormData & { parentProviderName?: string }>(data);
  const [idFilter, setIdFilter] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  // Apply provider defaults on fresh create (only when form is empty)
  useEffect(() => {
    if (data && !data.id && !data.name && providerDefaults) {
      setFormData((prev) => ({
        ...prev,
        toolCalling: providerDefaults.toolCalling ?? prev.toolCalling,
        vision: providerDefaults.vision ?? prev.vision,
        thinking: providerDefaults.thinking ?? prev.thinking,
        streaming: providerDefaults.streaming ?? prev.streaming,
        maxInputTokens: providerDefaults.maxInputTokens ?? prev.maxInputTokens,
        maxOutputTokens: providerDefaults.maxOutputTokens ?? prev.maxOutputTokens,
        url: providerDefaults.url ?? prev.url,
      }));
    }
  }, [data, providerDefaults]);

  useEffect(() => {
    setFormData(data);
    setIdFilter(data.id || "");
  }, [data]);

  // Filter remote models by typed text
  const filteredModels = useMemo(() => {
    if (!remoteModels || remoteModels.length === 0) return [];
    const filter = idFilter.toLowerCase().trim();
    if (!filter) return remoteModels.slice(0, 50); // show first 50
    return remoteModels
      .filter((m) => m.id.toLowerCase().includes(filter) || (m.name && m.name.toLowerCase().includes(filter)))
      .slice(0, 50);
  }, [remoteModels, idFilter]);

  const handleChange = (field: keyof ByokModelFormData, value: unknown) => {
    if (mode === "read") return;
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    postMessage("saveModel", {
      ...formData,
      parentId,
      isBatchMode,
    });
  };

  const hasRemoteModels = remoteModels && remoteModels.length > 0;

  return (
    <div id="model-form">
      <div className="header">
        <h2>
          {isBatchMode ? t("model.titleBatch", { count: batchCount ?? 0 }) : t("model.title")}
        </h2>
      </div>

      <div className="form-group">
        <label>{t("model.id")}</label>
        {hasRemoteModels ? (
          <div className="autocomplete-wrapper">
            <input
              type="text"
              value={formData.id || ""}
              onChange={(e) => {
                handleChange("id", e.target.value);
                setIdFilter(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              disabled={mode === "read"}
              placeholder={t("model.idSelectPlaceholder")}
            />
            {showDropdown && filteredModels.length > 0 && (
              <ul className="autocomplete-dropdown">
                {filteredModels.map((m) => (
                  <li
                    key={m.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleChange("id", m.id);
                      setIdFilter(m.id);
                      setShowDropdown(false);
                      // Also set name if available
                      if (m.name && m.name !== m.id) {
                        handleChange("name", m.name);
                      }
                    }}
                  >
                    <span className="model-id">{m.id}</span>
                    {m.name && m.name !== m.id && (
                      <span className="model-name-hint">{m.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <input
            type="text"
            value={formData.id || ""}
            onChange={(e) => handleChange("id", e.target.value)}
            disabled={mode === "read"}
            placeholder={t("model.idPlaceholder")}
          />
        )}
      </div>

      <div className="form-group">
        <label>{t("model.name")}</label>
        <input
          type="text"
          value={formData.name || ""}
          onChange={(e) => handleChange("name", e.target.value)}
          disabled={mode === "read"}
        />
      </div>

      <div className="form-group">
        <label>{t("model.url")}</label>
        <input
          type="text"
          value={formData.url || ""}
          onChange={(e) => handleChange("url", e.target.value)}
          disabled={mode === "read"}
          placeholder={t("model.urlPlaceholder")}
        />
      </div>

      <div className="form-group">
        <label>{t("model.maxInputTokens")}</label>
        <input
          type="number"
          value={formData.maxInputTokens ?? ""}
          onChange={(e) => handleChange("maxInputTokens", parseInt(e.target.value) || undefined)}
          disabled={mode === "read"}
        />
      </div>

      <div className="form-group">
        <label>{t("model.maxOutputTokens")}</label>
        <input
          type="number"
          value={formData.maxOutputTokens ?? ""}
          onChange={(e) => handleChange("maxOutputTokens", parseInt(e.target.value) || undefined)}
          disabled={mode === "read"}
        />
      </div>

      <div className="form-group">
        <label>Capabilities</label>
        <div className="checkbox-group">
          <label className="checkbox-item">
            <input
              type="checkbox"
              checked={!!formData.toolCalling}
              onChange={(e) => handleChange("toolCalling", e.target.checked || undefined)}
              disabled={mode === "read"}
            />{" "}
            {t("model.toolCalling")}
          </label>
          <label className="checkbox-item">
            <input
              type="checkbox"
              checked={!!formData.vision}
              onChange={(e) => handleChange("vision", e.target.checked || undefined)}
              disabled={mode === "read"}
            />{" "}
            {t("model.vision")}
          </label>
          <label className="checkbox-item">
            <input
              type="checkbox"
              checked={!!formData.thinking}
              onChange={(e) => handleChange("thinking", e.target.checked || undefined)}
              disabled={mode === "read"}
            />{" "}
            {t("model.thinking")}
          </label>
          <label className="checkbox-item">
            <input
              type="checkbox"
              checked={!!formData.streaming}
              onChange={(e) => handleChange("streaming", e.target.checked || undefined)}
              disabled={mode === "read"}
            />{" "}
            {t("model.streaming")}
          </label>
          <label className="checkbox-item">
            <input
              type="checkbox"
              checked={!!formData.supportsReasoningEffort}
              onChange={(e) => handleChange("supportsReasoningEffort", e.target.checked || undefined)}
              disabled={mode === "read"}
            />{" "}
            {t("model.supportsReasoningEffort")}
          </label>
        </div>
      </div>

      {mode !== "read" && (
        <div className="button-row">
          <button type="button" onClick={handleSave}>
            {t("common.save")}
          </button>
        </div>
      )}
    </div>
  );
};
