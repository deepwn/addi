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

/** Serialize reasoning effort for the select dropdown */
function serializeReasoningEffort(
  v: ByokModelDefaultSettings['supportsReasoningEffort']
): string {
  if (!v) return '';
  if (Array.isArray(v)) return JSON.stringify(v);
  return v;
}

/** Parse reasoning effort from the select dropdown */
function parseReasoningEffort(
  raw: string
): ByokModelDefaultSettings['supportsReasoningEffort'] {
  if (!raw) return undefined;
  if (raw.startsWith('[')) {
    try { return JSON.parse(raw) as ('low' | 'medium' | 'high')[]; } catch { return undefined; }
  }
  if (raw === 'low' || raw === 'medium' || raw === 'high') return raw;
  return undefined;
}

export const ProviderForm: React.FC<ProviderFormProps> = ({ data, mode, isCreate = false }) => {
  const { t, tRaw } = useLocale();
  const [formData, setFormData] = useState<ByokProviderFormData>(data);
  const [showDefaults, setShowDefaults] = useState(false);
  /** Coding plan alternate URL/ListApi (from preset) */
  const [codingPlan, setCodingPlan] = useState<{ url?: string; listApi?: string } | null>(null);
  /** Standard URL/ListApi stored when coding plan is toggled on */
  const [standardPlan, setStandardPlan] = useState<{ url?: string; listApi?: string } | null>(null);
  const [useCodingPlan, setUseCodingPlan] = useState(false);

  /** Reasoning effort options for the select dropdown */
  const reasoningEffortOptions = [
    { value: "", label: t("provider.reasoningEffortNone") },
    { value: "low", label: t("provider.reasoningEffortLow") },
    { value: "medium", label: t("provider.reasoningEffortMedium") },
    { value: "high", label: t("provider.reasoningEffortHigh") },
    { value: '["low","medium","high"]', label: t("provider.reasoningEffortAll") },
  ];

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
    // Clean up empty values
    const payload: Record<string, unknown> = {
      name: formData.name,
      vendor: formData.vendor || 'customendpoint',
      apiType: formData.apiType || 'chat-completions',
    };
    if (formData.apiKey) payload.apiKey = formData.apiKey;
    if (formData.url) payload.url = formData.url;
    if (formData.listApi) payload.listApi = formData.listApi;
    if (formData.defaultSettings && Object.keys(formData.defaultSettings).length > 0) {
      payload.defaultSettings = formData.defaultSettings;
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
        <label>{t("provider.apiUrl")}</label>
        <input
          type="text"
          value={formData.url || ""}
          onChange={(e) => handleChange("url", e.target.value)}
          placeholder={t("provider.apiUrlPlaceholder")}
          disabled={mode === "read"}
        />
        <div className="field-hint">{t("provider.apiUrlNote")}</div>

        {/* ── Coding Plan Toggle (inline after URL) ── */}
        {codingPlan && mode !== "read" && (
          <div className="coding-plan-toggle">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={useCodingPlan}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setUseCodingPlan(checked);
                  if (checked) {
                    // Save standard values, apply coding plan values
                    setStandardPlan({ url: formData.url, listApi: formData.listApi });
                    setFormData((prev) => ({
                      ...prev,
                      url: codingPlan.url ?? prev.url,
                      listApi: codingPlan.listApi ?? prev.listApi,
                    }));
                  } else if (standardPlan) {
                    // Restore standard values
                    setFormData((prev) => ({
                      ...prev,
                      url: standardPlan.url ?? prev.url,
                      listApi: standardPlan.listApi ?? prev.listApi,
                    }));
                    setStandardPlan(null);
                  }
                }}
              />
              {" "}
              {t("provider.codingPlanToggle")}
            </label>
            {useCodingPlan && (
              <div className="field-hint coding-plan-hint">{t("provider.codingPlanHint")}</div>
            )}
          </div>
        )}
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

      <div className="form-group">
        <label>{t("provider.listApi")}</label>
        <input
          type="text"
          value={formData.listApi || ""}
          onChange={(e) => handleChange("listApi", e.target.value)}
          placeholder={t("provider.listApiPlaceholder")}
          disabled={mode === "read"}
        />
        <div className="field-hint">{t("provider.listApiNote")}</div>
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

            <div className="form-group">
              <label>{t("provider.defaultCapabilities")}</label>
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
            </div>

            <div className="form-group">
              <label>{t("provider.defaultReasoningEffort")}</label>
              <select
                value={serializeReasoningEffort(formData.defaultSettings?.supportsReasoningEffort)}
                onChange={(e) => handleDefaultsChange("supportsReasoningEffort", parseReasoningEffort(e.target.value))}
                disabled={mode === "read"}
              >
                {reasoningEffortOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="field-hint">{t("provider.defaultReasoningEffortNote")}</div>
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
            // Store coding plan data if available
            if (preset.codingUrl || preset.codingListApi) {
              setCodingPlan({ url: preset.codingUrl, listApi: preset.codingListApi });
              setUseCodingPlan(false);
            } else {
              setCodingPlan(null);
              setUseCodingPlan(false);
            }
            setFormData((prev) => ({
              ...prev,
              name: preset.name,
              vendor: preset.vendor,
              apiType: preset.apiType,
              // Apply preset defaults (url, listApi) to provider-level fields
              url: preset.defaults?.url || prev.url,
              listApi: preset.defaults?.listApi || prev.listApi,
              // Apply preset defaults to model default settings
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
