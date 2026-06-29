import React, { useState, useEffect } from "react";
import type { ByokProviderFormData, ByokModelDefaultSettings } from "../types";
import { postMessage } from "../hooks/useVscode";
import { useLocale } from "../i18n";
import { ProviderPresetGrid } from "./ProviderPresetGrid";
import type { PresetSelectResult } from "./ProviderPresetGrid";

interface ProviderFormProps {
  data: ByokProviderFormData;
  mode: "edit" | "read";
  isCreate?: boolean;  // true = creating a new provider (show preset grid)
}

export const ProviderForm: React.FC<ProviderFormProps> = ({ data, mode, isCreate = false }) => {
  const { t, tRaw } = useLocale();
  const [formData, setFormData] = useState<ByokProviderFormData>(data);
  const [showDefaults, setShowDefaults] = useState(false);

  useEffect(() => {
    setFormData(data);
    // Auto-expand defaults section if there are existing settings
    if (data.defaultSettings && Object.keys(data.defaultSettings).length > 0) {
      setShowDefaults(true);
    }
  }, [data]);

  const handleChange = (field: keyof ByokProviderFormData, value: unknown) => {
    if (mode === "read") return;
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleDefaultsChange = (field: keyof ByokModelDefaultSettings, value: unknown) => {
    if (mode === "read") return;
    setFormData((prev) => ({
      ...prev,
      defaultSettings: {
        ...prev.defaultSettings,
        [field]: value,
      },
    }));
  };

  const handleSave = () => {
    // Clean up empty defaultSettings
    const payload = { ...formData };
    if (payload.defaultSettings && Object.keys(payload.defaultSettings).length === 0) {
      delete payload.defaultSettings;
    }
    postMessage("saveProvider", payload);
  };

  const apiTypeOptions = tRaw("provider.apiTypeOptions") as Record<string, string>;

  return (
    <div id="provider-form">
      <div className="header">
        <h2>{t("provider.title")}</h2>
      </div>

      <div className="form-group">
        <label>{t("provider.name")}</label>
        <input
          type="text"
          value={formData.name || ""}
          onChange={(e) => handleChange("name", e.target.value)}
          disabled={mode === "read"}
        />
      </div>

      <div className="form-group">
        <label>{t("provider.apiType")}</label>
        <select
          value={formData.apiType || "chat-completions"}
          onChange={(e) => handleChange("apiType", e.target.value)}
          disabled={mode === "read"}
        >
          <option value="chat-completions">{apiTypeOptions["chat-completions"]}</option>
          <option value="responses">{apiTypeOptions["responses"]}</option>
          <option value="messages">{apiTypeOptions["messages"]}</option>
        </select>
      </div>

      <div className="form-group">
        <label>{t("provider.apiKey")}</label>
        <input
          type="password"
          value={formData.apiKey || ""}
          onChange={(e) => handleChange("apiKey", e.target.value)}
          placeholder={t("provider.apiKeyPlaceholder")}
          disabled={mode === "read"}
        />
        <div className="field-hint">{t("provider.apiKeyNote")}</div>
      </div>

      {/* ── Model Defaults Section (collapsible) ── */}
      <div className="defaults-section">
        <div
          className="defaults-header"
          onClick={() => setShowDefaults(!showDefaults)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowDefaults(!showDefaults); }}
        >
          <span className="collapse-icon">{showDefaults ? "▾" : "▸"}</span>
          <span>{t("provider.defaultsSection")}</span>
        </div>
        {showDefaults && (
          <div className="defaults-body">
            <div className="field-hint" style={{ marginBottom: "8px" }}>
              {t("provider.defaultsDescription")}
            </div>

            <div className="form-group">
              <label>{t("provider.listApi")}</label>
              <input
                type="text"
                value={formData.defaultSettings?.listApi || ""}
                onChange={(e) => handleDefaultsChange("listApi", e.target.value)}
                placeholder={t("provider.listApiPlaceholder")}
                disabled={mode === "read"}
              />
              <div className="field-hint">{t("provider.listApiNote")}</div>
            </div>

            <div className="checkbox-group">
              <label className="checkbox-item">
                <input
                  type="checkbox"
                  checked={!!formData.defaultSettings?.toolCalling}
                  onChange={(e) => handleDefaultsChange("toolCalling", e.target.checked || undefined)}
                  disabled={mode === "read"}
                />{" "}
                {t("provider.defaultToolCalling")}
              </label>
              <label className="checkbox-item">
                <input
                  type="checkbox"
                  checked={!!formData.defaultSettings?.vision}
                  onChange={(e) => handleDefaultsChange("vision", e.target.checked || undefined)}
                  disabled={mode === "read"}
                />{" "}
                {t("provider.defaultVision")}
              </label>
              <label className="checkbox-item">
                <input
                  type="checkbox"
                  checked={!!formData.defaultSettings?.thinking}
                  onChange={(e) => handleDefaultsChange("thinking", e.target.checked || undefined)}
                  disabled={mode === "read"}
                />{" "}
                {t("provider.defaultThinking")}
              </label>
              <label className="checkbox-item">
                <input
                  type="checkbox"
                  checked={!!formData.defaultSettings?.streaming}
                  onChange={(e) => handleDefaultsChange("streaming", e.target.checked || undefined)}
                  disabled={mode === "read"}
                />{" "}
                {t("provider.defaultStreaming")}
              </label>
            </div>

            <div className="form-group">
              <label>{t("provider.defaultMaxInputTokens")}</label>
              <input
                type="number"
                value={formData.defaultSettings?.maxInputTokens ?? ""}
                onChange={(e) => handleDefaultsChange("maxInputTokens", parseInt(e.target.value) || undefined)}
                disabled={mode === "read"}
              />
            </div>

            <div className="form-group">
              <label>{t("provider.defaultMaxOutputTokens")}</label>
              <input
                type="number"
                value={formData.defaultSettings?.maxOutputTokens ?? ""}
                onChange={(e) => handleDefaultsChange("maxOutputTokens", parseInt(e.target.value) || undefined)}
                disabled={mode === "read"}
              />
            </div>
          </div>
        )}
      </div>

      {mode !== "read" && (
        <div className="button-row">
          <button type="button" onClick={handleSave}>
            {t("common.save")}
          </button>
        </div>
      )}

      {/* ── Quick-Add Preset Cards (only in create mode) ── */}
      {isCreate && (
        <ProviderPresetGrid
          onSelect={(preset: PresetSelectResult) => {
            setFormData((prev) => ({
              ...prev,
              name: preset.name,
              vendor: preset.vendor,
              apiType: preset.apiType,
              // Apply preset defaults (url, listApi) to defaultSettings
              defaultSettings: preset.defaults
                ? { ...prev.defaultSettings, ...preset.defaults }
                : prev.defaultSettings,
            }));
          }}
        />
      )}
    </div>
  );
};
