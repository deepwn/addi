import * as assert from 'assert';
import { z } from 'zod';
import {
  jsonSchemaToZod,
  safeConvertToZod,
} from '../../core/llm/schemaConverter';

suite('SchemaConverter Test Suite', () => {
  suite('Basic Types', () => {
    test('converts string schema', () => {
      const jsonSchema = {
        type: 'string',
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodString);
    });

    test('converts string schema with description', () => {
      const jsonSchema = {
        type: 'string',
        description: 'User name',
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodString);
    });

    test('converts string schema with min/max length', () => {
      const jsonSchema = {
        type: 'string',
        minLength: 5,
        maxLength: 50,
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodString);
    });

    test('converts string schema with pattern', () => {
      const jsonSchema = {
        type: 'string',
        pattern: '^[a-zA-Z]+$',
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodString);
    });

    test('converts string schema with enum', () => {
      const jsonSchema = {
        type: 'string',
        enum: ['red', 'green', 'blue'],
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodEnum);
    });

    test('converts number schema', () => {
      const jsonSchema = {
        type: 'number',
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodNumber);
    });

    test('converts integer schema', () => {
      const jsonSchema = {
        type: 'integer',
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodNumber);
    });

    test('converts number schema with min/max', () => {
      const jsonSchema = {
        type: 'number',
        minimum: 0,
        maximum: 100,
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodNumber);
    });

    test('converts boolean schema', () => {
      const jsonSchema = {
        type: 'boolean',
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodBoolean);
    });
  });

  suite('Object Types', () => {
    test('converts empty object schema', () => {
      const jsonSchema = {
        type: 'object',
        properties: {},
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodObject);
    });

    test('converts object schema with properties', () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodObject);

      const result = zodSchema.safeParse({ name: 'John', age: 30 });
      assert.strictEqual(result.success, true);
    });

    test('converts object schema with required fields', () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);

      const result1 = zodSchema.safeParse({ name: 'John' });
      assert.strictEqual(result1.success, true);

      const result2 = zodSchema.safeParse({ age: 30 });
      assert.strictEqual(result2.success, false);
    });

    test('converts object schema with nested properties', () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
            },
          },
        },
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);

      const result = zodSchema.safeParse({
        user: { name: 'John', email: 'john@example.com' },
      });
      assert.strictEqual(result.success, true);
    });

    test('converts object schema with description', () => {
      const jsonSchema = {
        type: 'object',
        description: 'User information',
        properties: {
          name: { type: 'string' },
        },
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodObject);
    });
  });

  suite('Array Types', () => {
    test('converts array schema without items', () => {
      const jsonSchema = {
        type: 'array',
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodArray);
    });

    test('converts array schema with items', () => {
      const jsonSchema = {
        type: 'array',
        items: { type: 'string' },
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodArray);
    });

    test('converts array schema with min/max items', () => {
      const jsonSchema = {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodArray);
    });

    test('converts array schema with object items', () => {
      const jsonSchema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            name: { type: 'string' },
          },
        },
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);

      const result = zodSchema.safeParse([
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
      ]);
      assert.strictEqual(result.success, true);
    });
  });

  suite('Nullable Types', () => {
    test('converts nullable string using type array', () => {
      const jsonSchema = {
        type: ['string', 'null'],
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);

      const result1 = zodSchema.safeParse('hello');
      assert.strictEqual(result1.success, true);

      const result2 = zodSchema.safeParse(null);
      assert.strictEqual(result2.success, true);
    });

    test('converts nullable number using anyOf', () => {
      const jsonSchema = {
        anyOf: [{ type: 'number' }, { type: 'null' }],
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);

      const result1 = zodSchema.safeParse(42);
      assert.strictEqual(result1.success, true);

      const result2 = zodSchema.safeParse(null);
      assert.strictEqual(result2.success, true);
    });

    test('converts nullable object using oneOf', () => {
      const jsonSchema = {
        oneOf: [
          {
            type: 'object',
            properties: { name: { type: 'string' } },
          },
          { type: 'null' },
        ],
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);

      const result1 = zodSchema.safeParse({ name: 'John' });
      assert.strictEqual(result1.success, true);

      const result2 = zodSchema.safeParse(null);
      assert.strictEqual(result2.success, true);
    });
  });

  suite('Complex Types', () => {
    test('converts complex nested schema', () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
          },
          age: {
            type: 'integer',
            minimum: 0,
            maximum: 150,
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            minItems: 0,
            maxItems: 10,
          },
          address: {
            type: 'object',
            properties: {
              street: { type: 'string' },
              city: { type: 'string' },
            },
          },
        },
        required: ['name'],
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);

      const validData = {
        name: 'John Doe',
        age: 30,
        tags: ['tag1', 'tag2'],
        address: {
          street: '123 Main St',
          city: 'New York',
        },
      };

      const result = zodSchema.safeParse(validData);
      assert.strictEqual(result.success, true);
    });

    test('converts schema with anyOf', () => {
      const jsonSchema = {
        anyOf: [
          { type: 'string' },
          { type: 'number' },
        ],
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);

      const result1 = zodSchema.safeParse('hello');
      const result2 = zodSchema.safeParse(42);
      assert.strictEqual(result1.success, true);
      assert.strictEqual(result2.success, true);
    });

    test('converts schema with oneOf', () => {
      const jsonSchema = {
        oneOf: [
          { type: 'string', enum: ['active', 'inactive'] },
          { type: 'string', enum: ['pending', 'completed'] },
        ],
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);

      const result1 = zodSchema.safeParse('active');
      const result2 = zodSchema.safeParse('pending');
      assert.strictEqual(result1.success, true);
      assert.strictEqual(result2.success, true);
    });
  });

  suite('Error Handling', () => {
    test('handles null or undefined schema', () => {
      const zodSchema = safeConvertToZod(null);
      assert.ok(zodSchema instanceof z.ZodAny);

      const zodSchema2 = safeConvertToZod(undefined);
      assert.ok(zodSchema2 instanceof z.ZodAny);
    });

    test('handles invalid schema with fallback', () => {
      const invalidSchema = { invalid: 'schema' };
      const fallback = z.object({});

      const zodSchema = safeConvertToZod(invalidSchema, fallback);
      assert.ok(zodSchema instanceof z.ZodObject);
    });

    test('handles schema without type', () => {
      const jsonSchema = {
        properties: {
          name: { type: 'string' },
        },
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodObject);
    });

    test('handles schema with only items', () => {
      const jsonSchema = {
        items: { type: 'string' },
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodArray);
    });
  });

  suite('Edge Cases', () => {
    test('handles empty schema', () => {
      const jsonSchema = {};

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodAny);
    });

    test('handles null-only type', () => {
      const jsonSchema = {
        type: 'null',
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);
      assert.ok(zodSchema instanceof z.ZodNull);
    });

    test('filters out null from combinators', () => {
      const jsonSchema = {
        anyOf: [
          { type: 'string' },
          { type: 'null' },
          { type: 'number' },
        ],
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);

      const result1 = zodSchema.safeParse('hello');
      const result2 = zodSchema.safeParse(null);
      const result3 = zodSchema.safeParse(42);
      assert.strictEqual(result1.success, true);
      assert.strictEqual(result2.success, true);
      assert.strictEqual(result3.success, true);
    });
  });

  suite('Real-world Examples', () => {
    test('converts tool schema for file operations', () => {
      const jsonSchema = {
        type: 'object',
        description: 'File operation parameters',
        properties: {
          path: {
            type: 'string',
            description: 'File path',
            minLength: 1,
          },
          content: {
            type: ['string', 'null'],
            description: 'File content',
          },
          createIfNotExists: {
            type: 'boolean',
            description: 'Create file if it does not exist',
          },
        },
        required: ['path'],
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);

      const result = zodSchema.safeParse({
        path: '/path/to/file.txt',
        content: 'Hello, World!',
        createIfNotExists: true,
      });

      assert.strictEqual(result.success, true);
    });

    test('converts complex API response schema', () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          users: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                name: { type: 'string' },
                email: { type: 'string', format: 'email' },
                role: {
                  type: 'string',
                  enum: ['admin', 'user', 'guest'],
                },
              },
              required: ['id', 'name', 'email'],
            },
          },
          total: { type: 'integer', minimum: 0 },
        },
        required: ['users', 'total'],
      };

      const zodSchema = jsonSchemaToZod(jsonSchema);

      const result = zodSchema.safeParse({
        users: [
          { id: 1, name: 'John', email: 'john@example.com', role: 'admin' },
          { id: 2, name: 'Jane', email: 'jane@example.com', role: 'user' },
        ],
        total: 2,
      });

      assert.strictEqual(result.success, true);
    });
  });
});
