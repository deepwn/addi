import { CustomTool } from '../types';
import { logger } from '../logger';

export class ToolParser {
  static parse(data: any, fileName: string, source: string): CustomTool | null {
    try {
      // Basic validation
      if (!data.name || !data.description) {
        return null;
      }

      // Parse Steps
      const steps: any[] = [];
      if (data.runs && data.runs.steps && Array.isArray(data.runs.steps)) {
        // GitHub Actions Composite format
        steps.push(...data.runs.steps);
      } else if (data.steps && Array.isArray(data.steps)) {
        steps.push(...data.steps);
      } else if (data.command) {
        // Legacy/Simple format support
        steps.push({
          name: 'default',
          command: data.command,
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
        if (current.length > 0) {
          parts.push(current);
        }
        return parts;
      };

      const normalizedSteps: any[] = [];
      for (const s of steps) {
        const ns: any = { ...s };

        if (s.shell) {
          logger.debug(
            `ToolParser: Found shell property for step ${s.name || 'unnamed'}: ${s.shell}`
          );
        } else {
          logger.debug(`ToolParser: No shell property for step ${s.name || 'unnamed'}`);
        }

        // If step has `run` as string, we now preserve it as a script string
        // UNLESS it's a simple one-liner that we might want to split for legacy reasons?
        // Actually, the new requirement is to support GH Actions style scripts.
        // So if it's a string, we keep it as a string.
        // However, to maintain backward compatibility with the "structured" expectation of some parts of the code
        // (if any remain), we need to be careful.
        // But CustomToolExecutor will be updated to handle string `run`.

        // We only normalize if it's the legacy `command` field or array format.
        // If `run` is already a string, we trust it as a shell script.

        if (Array.isArray(s.run)) {
          // run: ["cmd","arg1"] -> { command: "cmd", args: ["arg1"] }
          if (s.run.length > 0) {
            ns.run = { command: String(s.run[0]), args: s.run.slice(1).map(String) };
          }
        } else if (s.command) {
          // legacy `command` field -> { command: "cmd", args: [...] }
          const cmd = String(s.command);
          if (s.args && Array.isArray(s.args)) {
            ns.run = { command: cmd, args: s.args.map(String) };
          } else {
            const tokens = splitArgsRespectingQuotes(cmd);
            ns.run = tokens.length > 0 ? { command: tokens[0], args: tokens.slice(1) } : undefined;
          }
        }
        // If s.run is a string, we leave it alone now.
        // If s.run is an object {command, args}, we leave it alone.

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

          // Required by default unless explicitly false or has a default value
          if (!(value && value.required === false) && !(value && value.default !== undefined)) {
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

      const visibility =
        source === 'global'
          ? 'global'
          : source.indexOf('public') >= 0
            ? 'public'
            : source.indexOf('private') >= 0
              ? 'private'
              : 'public';
      return {
        id: `${source}:${fileName}:${data.name}`,
        name: data.name,
        description: data.description,
        parameters: parameters || { type: 'object', properties: {} },
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
