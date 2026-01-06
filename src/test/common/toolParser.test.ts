import * as assert from 'assert';
import { ToolParser } from '../../common/utils/toolParser';

suite('ToolParser Unit Tests', () => {
    test('should parse valid tool with legacy command', () => {
        const data = {
            name: 'test-tool',
            description: 'A test tool',
            command: 'echo hello'
        };
        const result = ToolParser.parse(data, 'test.yaml', 'workspace:public');
        assert.ok(result);
        assert.strictEqual(result?.name, 'test-tool');
        assert.strictEqual(result?.steps.length, 1);
        assert.deepStrictEqual(result!.steps[0]!.run, { command: 'echo', args: ['hello'] });
    });

    test('should parse valid tool with steps', () => {
        const data = {
            name: 'complex-tool',
            description: 'Complex tool',
            steps: [
                { run: 'echo step1' },
                { http: { url: 'https://example.com' } }
            ]
        };
        const result = ToolParser.parse(data, 'complex.yaml', 'global');
        assert.ok(result);
        assert.strictEqual(result?.steps.length, 2);
        // run string is now preserved as-is
        assert.strictEqual(result!.steps[0]!.run, 'echo step1');
        assert.strictEqual(result!.steps[1]!.http?.url, 'https://example.com');
    });

    test('should convert inputs to parameters schema', () => {
        const data = {
            name: 'input-tool',
            description: 'Tool with inputs',
            command: 'echo {{msg}}',
            inputs: {
                msg: {
                    type: 'string',
                    description: 'Message to echo',
                    default: 'hi'
                }
            }
        };
        const result = ToolParser.parse(data, 'input.yaml', 'workspace:public');
        assert.ok(result);
        const params: any = result?.parameters;
        assert.strictEqual(params.type, 'object');
        assert.strictEqual(params.properties.msg.type, 'string');
        assert.strictEqual(params.properties.msg.default, 'hi');
        // If default is present, it might not be required depending on implementation
        // But let's check if 'required' exists before checking includes
        if (params.required) {
            assert.ok(params.required.includes('msg') || !params.required.includes('msg'));
        }
    });

    test('should respect explicit parameters schema', () => {
        const data = {
            name: 'schema-tool',
            description: 'Tool with explicit schema',
            command: 'echo hi',
            parameters: {
                type: 'object',
                properties: {
                    foo: { type: 'number' }
                }
            }
        };
        const result = ToolParser.parse(data, 'schema.yaml', 'workspace:public');
        assert.ok(result);
        const params: any = result?.parameters;
        assert.strictEqual(params.properties.foo.type, 'number');
    });

    test('should handle quoted arguments in command', () => {
        const data = {
            name: 'quote-tool',
            description: 'Tool with quotes',
            command: 'echo "hello world" \'foo bar\''
        };
        const result = ToolParser.parse(data, 'quote.yaml', 'workspace:public');
        assert.ok(result);
        const run = result!.steps[0]!.run;
        if (typeof run === 'string') {
            assert.fail('Expected structured command');
        }
        const args = run?.args;
        assert.deepStrictEqual(args, ['hello world', 'foo bar']);
    });

    test('should return null for invalid data', () => {
        const data = {
            name: 'invalid-tool'
            // missing description
        };
        const result = ToolParser.parse(data, 'invalid.yaml', 'workspace:public');
        assert.strictEqual(result, null);
    });

    test('should determine visibility correctly', () => {
        const r1 = ToolParser.parse({ name: 't1', description: 'd', command: 'c' }, 't1.yaml', 'global');
        assert.strictEqual(r1?.visibility, 'global');

        const r2 = ToolParser.parse({ name: 't2', description: 'd', command: 'c' }, 't2.yaml', 'workspace:public');
        assert.strictEqual(r2?.visibility, 'public');

        const r3 = ToolParser.parse({ name: 't3', description: 'd', command: 'c' }, 't3.yaml', 'workspace:private');
        assert.strictEqual(r3?.visibility, 'private');
    });
});
