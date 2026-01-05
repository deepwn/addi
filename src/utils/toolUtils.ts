export class ToolUtils {
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
