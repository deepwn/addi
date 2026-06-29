/* ---- Preset data types (mirrors presets.json) ---- */

export interface PresetProfile {
  apiType: string;  // ByokApiType: 'chat-completions' | 'azure-chat-completions' | 'messages' | 'responses' | 'completions' | 'realtime'
  label: string;
  description: string;
  defaults?: Partial<Record<string, unknown>>;
}

export interface ProviderPreset {
  id: string;
  iconKey: string;
  name: string;
  vendor: string;
  profiles: PresetProfile[];
}

export interface PresetsData {
  "$schema"?: string;
  description?: string;
  providers: ProviderPreset[];
}
