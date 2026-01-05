import * as assert from 'assert';
import { ToolUtils } from '../../utils/toolUtils';

suite('ToolUtils Unit Tests', () => {
    test('should replace simple placeholders', () => {
        const template = 'Hello {{name}}';
        const values = { name: 'World' };
        const result = ToolUtils.replacePlaceholders(template, values);
        assert.strictEqual(result, 'Hello World');
    });

    test('should replace multiple placeholders', () => {
        const template = '{{greeting}} {{name}}';
        const values = { greeting: 'Hi', name: 'User' };
        const result = ToolUtils.replacePlaceholders(template, values);
        assert.strictEqual(result, 'Hi User');
    });

    test('should handle nested properties', () => {
        const template = 'Value: {{a.b}}';
        const values = { a: { b: 123 } };
        const result = ToolUtils.replacePlaceholders(template, values);
        assert.strictEqual(result, 'Value: 123');
    });

    test('should keep unknown placeholders', () => {
        const template = 'Hello {{unknown}}';
        const values = { name: 'World' };
        const result = ToolUtils.replacePlaceholders(template, values);
        assert.strictEqual(result, 'Hello {{unknown}}');
    });

    test('should handle missing values object', () => {
        const template = 'Hello {{name}}';
        const result = ToolUtils.replacePlaceholders(template, null);
        assert.strictEqual(result, 'Hello {{name}}');
    });
});
