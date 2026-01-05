import * as yaml from 'js-yaml';

class ToolUtils {
    static replacePlaceholders(template: string, values: any): string {
        // Match GitHub Actions style: ${{ inputs.key }}
        return template.replace(/\$\{\{\s*([^}]+)\s*\}\}/g, (match, key) => {
            const keys = key.trim().split('.');
            let value = values;
            for (const k of keys) {
                if (value && typeof value === 'object' && k in value) {
                    value = value[k];
                } else {
                    return match; // Keep placeholder if not found
                }
            }
            return value !== undefined ? String(value) : match;
        });
    }
}

class ToolParser {
  static parse(data: any, fileName: string, source: string): any | null {
      // Simplified parse logic focusing on inputs
      let parameters = data.parameters;
      if (data.inputs && !data.parameters) {
        const properties: Record<string, any> = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(data.inputs) as [string, any][]) {
          const prop: any = {};
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

          // Logic from my fix
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
        parameters.additionalProperties = false;
      }

      return {
        name: data.name,
        parameters: parameters || { type: "object", properties: {} },
        steps: data.steps
      };
  }
}

const yamlContent = `
name: test_get_remoteip
description: Returns the public IP address...
inputs:
  ip:
    description: The IP address to query. Leave empty to query the current IP.
    default: ""
    type: string
steps:
  - http:
      url: http://ip-api.com/json/\${{ inputs.ip }}
      method: GET
`;

const data = yaml.load(yamlContent);
const tool = ToolParser.parse(data, 'test.yaml', 'test');

// Simulate CustomToolExecutor logic
const rawInput = {}; // No input provided
const input: Record<string, any> = { ...rawInput };

// Apply defaults
const props = tool?.parameters?.properties;
if (props) {
    for (const key of Object.keys(props)) {
        const prop = props[key] as any;
        if (typeof prop === 'object' && prop !== null && 'default' in prop && input[key] === undefined) {
            input[key] = prop.default;
        }
    }
}

console.log('Input after defaults:', JSON.stringify(input, null, 2));

// Prepare context for replacement
const context = { inputs: input };
console.log('Context:', JSON.stringify(context, null, 2));

// Replace
const urlTemplate = tool?.steps[0].http.url;
const replacedUrl = ToolUtils.replacePlaceholders(urlTemplate, context);

console.log('URL Template:', urlTemplate);
console.log('Replaced URL:', replacedUrl);
