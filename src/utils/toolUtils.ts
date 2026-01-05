export class ToolUtils {
    static replacePlaceholders(template: string, values: any): string {
        return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
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
