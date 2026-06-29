import React, { useState, useMemo, useCallback } from "react";
import { getLobeIconCDN } from "../utils/getLobeIconCDN";
import { useLocale } from "../i18n";
import presetsJson from "../data/presets.json";
import type { PresetsData, ProviderPreset, PresetProfile } from "../data/presetTypes";

/* ========== Load preset data ========== */

const presets = presetsJson as PresetsData;

/* ========== Component props ========== */

export interface PresetSelectResult {
  name: string;
  vendor: string;
  apiType: string;
  defaults?: Record<string, unknown>;
}

interface Props {
  onSelect: (result: PresetSelectResult) => void;
}

/* ========== Sub-component: profile chooser popover ========== */

const ProfileChooser: React.FC<{
  preset: ProviderPreset;
  onPick: (profile: PresetProfile) => void;
  onClose: () => void;
}> = ({ preset, onPick, onClose }) => (
  <div className="profile-chooser-overlay" onClick={onClose}>
    <div className="profile-chooser" onClick={(e) => e.stopPropagation()}>
      <div className="profile-chooser-header">
        <img
          className="profile-chooser-icon"
          src={getLobeIconCDN(preset.iconKey, { type: "color", format: "svg", cdn: "unpkg" })}
          alt={preset.name}
        />
        <span className="profile-chooser-title">{preset.name}</span>
      </div>
      <div className="profile-chooser-list">
        {preset.profiles.map((profile) => (
          <button
            key={profile.apiType}
            className="profile-chooser-item"
            type="button"
            onClick={() => onPick(profile)}
          >
            <span className="profile-chooser-label">{profile.label}</span>
            <span className="profile-chooser-desc">{profile.description}</span>
          </button>
        ))}
      </div>
    </div>
  </div>
);

/* ========== Main grid component ========== */

export const ProviderPresetGrid: React.FC<Props> = ({ onSelect }) => {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [activePreset, setActivePreset] = useState<ProviderPreset | null>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return presets.providers;
    const q = query.toLowerCase();
    return presets.providers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
    );
  }, [query]);

  const handleCardClick = useCallback((preset: ProviderPreset) => {
    if (preset.profiles.length === 1 && preset.profiles[0]) {
      // Single profile → apply immediately
      const profile = preset.profiles[0];
      onSelect({
        name: preset.name,
        vendor: preset.vendor,
        apiType: profile.apiType,
        defaults: profile.defaults as Record<string, unknown> | undefined,
      });
    } else {
      // Multiple profiles → show chooser
      setActivePreset(preset);
    }
  }, [onSelect]);

  const handleProfilePick = useCallback((profile: PresetProfile) => {
    if (!activePreset) return;
    onSelect({
      name: activePreset.name,
      vendor: activePreset.vendor,
      apiType: profile.apiType,
      defaults: profile.defaults as Record<string, unknown> | undefined,
    });
    setActivePreset(null);
  }, [activePreset, onSelect]);

  return (
    <div className="quick-add-section">
      <div className="divider" />
      <h3>{t("provider.quickAddTitle")}</h3>

      <input
        className="quick-add-search"
        type="text"
        placeholder={t("provider.quickAddSearchPlaceholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="preset-cards-grid">
        {filtered.map((preset) => (
          <button
            key={preset.id}
            className="preset-card"
            type="button"
            onClick={() => handleCardClick(preset)}
            title={
              preset.profiles.length > 1
                ? `${preset.profiles.length} API profiles`
                : preset.profiles[0]?.description ?? preset.name
            }
          >
            <img
              className="preset-card-icon"
              src={getLobeIconCDN(preset.iconKey, {
                type: "color",
                format: "svg",
                cdn: "unpkg",
              })}
              alt={preset.name}
            />
            <span className="preset-card-name">{preset.name}</span>
            {preset.profiles.length > 1 && (
              <span className="preset-card-badge">
                {preset.profiles.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Profile chooser modal */}
      {activePreset && (
        <ProfileChooser
          preset={activePreset}
          onPick={handleProfilePick}
          onClose={() => setActivePreset(null)}
        />
      )}
    </div>
  );
};
