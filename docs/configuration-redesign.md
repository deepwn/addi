# Configuration System Redesign

## 1. Problem Statement

The current configuration management in Addi mixes three distinct types of data:
1.  **Static Configuration**: Provider details (endpoints, model definitions). This should be synced across devices.
2.  **Runtime Statistics**: Model speed history, usage counts. This is local-only and high-frequency (changes often).
3.  **Secrets**: API Keys. This must be encrypted and handled securely.

Currently, `Provider` and `Model` interfaces combine all these fields. This leads to:
- **Inefficient Sync**: Changing `speedHistory` triggers a Settings Sync event for the whole provider list.
- **Data Pollution**: Exported configs (`addi-config.json`) contain local runtime stats.
- **Security Risks**: While secrets are stripped in storage, the unified interface makes accidental exposure easier during serialization.

## 2. Proposed Architecture

We will separate the data into three distinct stores managed by `StorageService`, while maintaining a unified interface for the application layer ("Facade Pattern").

### 2.1 Data Structures (Storage Layer)

**1. `addi.config` (Synced GlobalState)**
Stores the structure of providers and models.
```typescript
interface ProviderConfig {
  id: string; // UUID
  name: string;
  type: ProviderType;
  apiEndpoint?: string;
  models: ModelConfig[];
  enabled: boolean;
}

interface ModelConfig {
  sid: string; // UUID
  refId: string; // "gpt-4"
  name: string;
  capabilities: ModelCapabilities;
  // Static config only
}
```

**2. `addi.stats` (Local GlobalState)**
Stores runtime metrics. Never synced.
```typescript
interface RuntimeStats {
  [modelSid: string]: {
    speedHistory: number[];
    averageSpeed: number;
    lastUsed: number;
    failureCount: number;
  }
}
```

**3. `secrets` (VS Code SecretStorage)**
Stores API keys indexed by Provider ID.

### 2.2 Application Layer (Facade)

The `IStorageService.getProviders()` method will continue to return rich objects, assembling them on the fly:

```typescript
// The "Rich" model used by the rest of the application
interface Provider {
  // ... from Config
  apiKey?: string; // Injected from Secrets
  models: Model[];
}

interface Model {
  // ... from Config
  speedHistory: number[]; // Injected from Stats
  averageSpeed: number;   // Injected from Stats
}
```

## 3. Implementation Plan

1.  **Refactor Types**: Separate `Model` into `ModelConfig` and `ModelStats`.
2.  **Update StorageService**:
    - `saveProviders`: Split the incoming rich object into Config (synced), Secrets (secure), and Stats (local).
    - `getProviders`: Join the three sources back together.
3.  **Migration**: On startup, detect old storage format and migrate data to the new split structure.
4.  **Export/Import**: Update commands to export only `ProviderConfig` by default (clean export).

## 4. Benefits

- **Better Sync**: Frequency changes in stats won't trigger sync conflicts.
- **Cleaner Configs**: Exported files are readable and version-controllable.
- **Security**: Clear boundary for secrets.
