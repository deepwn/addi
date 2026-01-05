import { CustomTool } from "../types";
import { logger } from "../logger";

export class ToolParser {
  static parse(data: any, fileName: string, source: string): CustomTool | null {
    try {
      // Basic validation
      if (!data.name || !data.description) {
        return null;
      }

      // Parse Steps
      const steps: any[] = [];
      if (data.steps && Array.isArray(data.steps)) {
        steps.push(...data.steps);
      } else if (data.command) {
        // Legacy/Simple format support
        steps.push({
          name: "default",
          run: data.command,
        });
      } else if (data.http) {
        // Legacy/Simple format support
        steps.push({
          name: "default",
          http: data.http,
        });
      }

      if (steps.length === 0) {
        return null;
      }

      // Normalize steps: convert legacy `run` string or `command` into structured { command, args }
      const splitArgsRespectingQuotes = (s: string) => {
        const parts: string[] = [];
        let current = '';
        let inSingle = false;
        let inDouble = false;
        for (let i = 0; i < s.length; i++) {
          const ch = s[i];
          if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
            continue;
          }
          if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
          }
          if (ch === ' ' && !inSingle && !inDouble) {
            if (current.length > 0) {
              parts.push(current);
              current = '';
            }
            continue;
          }
          current += ch;
        }
        if (current.length > 0) { parts.push(current); }
        return parts;
      };

      const normalizedSteps: any[] = [];
      for (const s of steps) {
        const ns: any = { ...s };
        // If step has `run` as string, split into command + args
        if (s.run && typeof s.run === 'string') {
          const tokens = splitArgsRespectingQuotes(s.run);
          if (tokens.length > 0) {
            ns.run = { command: tokens[0], args: tokens.slice(1) };
          }
        } else if (Array.isArray(s.run)) {
          // run: ["cmd","arg1"]
          if (s.run.length > 0) {
            ns.run = { command: String(s.run[0]), args: s.run.slice(1).map(String) };
          }
        } else if (s.command) {
          // legacy `command` field
          const cmd = String(s.command);
          if (s.args && Array.isArray(s.args)) {
            ns.run = { command: cmd, args: s.args.map(String) };
          } else {
            const tokens = splitArgsRespectingQuotes(cmd);
            ns.run = tokens.length > 0 ? { command: tokens[0], args: tokens.slice(1) } : undefined;
          }
        }

        normalizedSteps.push(ns);
      }

      // replace steps with normalized version
      const finalSteps = normalizedSteps;

      // Convert simplified `inputs` to a JSON Schema `parameters` object
      // If `parameters` already provided in YAML, keep it. Otherwise build from `inputs`.
      let parameters = data.parameters;
      if (data.inputs && !data.parameters) {
        const properties: Record<string, any> = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(data.inputs) as [string, any][]) {
          const prop: any = {};
          // Allow explicit type in YAML, otherwise default to string
          if (value && value.type) {
            prop.type = value.type;
          } else {
            prop.type = 'string';
          }

          if (value && value.description) {
            prop.description = value.description;
          }
          if (value && value.default !== undefined) {
            prop.default = value.default;
          }

          // Required by default unless explicitly false
          if (!(value && value.required === false)) {
            required.push(key);
          }

          properties[key] = prop;
        }

        parameters = {
          type: 'object',
          properties,
        } as any;

        if (required.length > 0) {
          parameters.required = required;
        }

        // Be explicit about additionalProperties to avoid surprises when validating
        parameters.additionalProperties = false;
      }

      const visibility = source === 'global' ? 'global' : (source.indexOf('public') >= 0 ? 'public' : (source.indexOf('private') >= 0 ? 'private' : 'public'));
      return {
        id: `${source}:${fileName}:${data.name}`,
        name: data.name,
        description: data.description,
        parameters: parameters || { type: "object", properties: {} },
        steps: finalSteps,
        source: source === 'global' ? 'global' : 'workspace',
        visibility,
        fileName,
      };
    } catch (e) {
      logger.error(`Error parsing tool data for ${fileName}`, e);
      return null;
    }
  }
}
