/**
 * Schema Converter Module
 *
 * This module converts JSON Schema definitions to Zod schemas, following
 * the AI SDK's recommended approach for structured data generation and tool calling.
 *
 * Reference: https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data
 * Reference: https://ai-sdk.dev/docs/reference/ai-sdk-core/zod-schema
 */

import { z } from 'zod';

/**
 * Convert a JSON Schema definition to a Zod schema
 *
 * This function handles common JSON Schema types and converts them to
 * equivalent Zod schemas. It supports:
 * - Basic types: string, number, integer, boolean, array, object
 * - Nullable types (using anyOf/oneOf with null)
 * - Optional properties (not in required array)
 * - Descriptions (via .describe())
 * - Array items and object properties
 *
 * @param schema - JSON Schema definition
 * @returns Zod schema
 */
export function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') {
    return z.any();
  }

  // Handle combinators (anyOf, oneOf, allOf)
  if (schema.anyOf) {
    return handleCombinator(schema.anyOf, 'anyOf');
  }

  if (schema.oneOf) {
    return handleCombinator(schema.oneOf, 'oneOf');
  }

  if (schema.allOf) {
    return handleCombinator(schema.allOf, 'allOf');
  }

  // Handle nullable via type array: ["string", "null"]
  if (Array.isArray(schema.type)) {
    return handleArrayType(schema.type);
  }

  // Handle nullable via explicit null in combinators
  if (schema.type === 'null') {
    return z.null();
  }

  // Handle basic types
  switch (schema.type) {
    case 'string':
      return createStringSchema(schema);
    case 'number':
    case 'integer':
      return createNumberSchema(schema);
    case 'boolean':
      return z.boolean();
    case 'array':
      return createArraySchema(schema);
    case 'object':
      return createObjectSchema(schema);
    default:
      // If no type is specified but properties exist, treat as object
      if (schema.properties) {
        return createObjectSchema(schema);
      }
      if (schema.items) {
        return createArraySchema(schema);
      }
      return z.any();
  }
}

/**
 * Handle array of types (e.g., ["string", "null"])
 */
function handleArrayType(types: string[]): z.ZodTypeAny {
  const nonNullTypes = types.filter((t) => t !== 'null');

  if (nonNullTypes.length === 0) {
    return z.null();
  }

  if (nonNullTypes.length === 1) {
    const baseSchema = typeToZod(nonNullTypes[0] as string);
    // Add nullable if null was in the original array
    return types.includes('null') ? baseSchema.nullable() : baseSchema;
  }

  // If we have multiple non-null types, treat as anyOf
  const schemas = nonNullTypes.map((t) => typeToZod(t as string));
  const defined = schemas.filter(Boolean) as z.ZodTypeAny[];
  if (defined.length === 1) {
    return types.includes('null') ? defined[0]!.nullable() : defined[0]!;
  }
  const combined = z.union(defined as any);
  return types.includes('null') ? combined.nullable() : combined;
}

/**
 * Convert a basic type string to Zod schema
 */
function typeToZod(type: string): z.ZodTypeAny {
  switch (type) {
    case 'string':
      return z.string();
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(z.any());
    case 'object':
      return z.object({});
    default:
      return z.any();
  }
}

/**
 * Handle combinators (anyOf, oneOf, allOf)
 */
function handleCombinator(schemas: any[], type: 'anyOf' | 'oneOf' | 'allOf'): z.ZodTypeAny {
  const nonNullSchemas = schemas.filter((s: any) => s && s.type !== 'null');
  const hasNull = schemas.some((s: any) => s && s.type === 'null');

  if (nonNullSchemas.length === 0) {
    return hasNull ? z.null() : z.any();
  }

  const zodSchemas = nonNullSchemas.map((s) => jsonSchemaToZod(s));

  let result: z.ZodTypeAny;

  if (type === 'anyOf' || type === 'oneOf') {
    if (zodSchemas.length === 1) {
      result = zodSchemas[0] as z.ZodTypeAny;
    } else {
      result = z.union(zodSchemas as any);
    }
  } else {
    // For allOf, intersect schemas safely
    result = zodSchemas[0] as any;
    for (let i = 1; i < zodSchemas.length; i++) {
      if (!zodSchemas[i]) {
        continue;
      }
      result = z.intersection(result, zodSchemas[i] as any) as any;
    }
  }

  return hasNull ? result.nullable() : result;
}

/**
 * Create a string schema with optional validation
 */
function createStringSchema(schema: any): z.ZodTypeAny {
  // If enum is provided, return an enum schema immediately
  if (schema.enum && Array.isArray(schema.enum)) {
    let e: z.ZodTypeAny = (z as any).enum(schema.enum);
    if (schema.description) {
      try {
        e = e.describe(schema.description);
      } catch {}
    }
    return e;
  }

  let result: z.ZodString = z.string();

  if (schema.minLength !== undefined) {
    result = result.min(schema.minLength);
  }

  if (schema.maxLength !== undefined) {
    result = result.max(schema.maxLength);
  }

  if (schema.pattern) {
    result = result.regex(new RegExp(schema.pattern));
  }

  if (schema.description) {
    result = result.describe(schema.description);
  }

  return result;
}

/**
 * Create a number schema with optional validation
 */
function createNumberSchema(schema: any): z.ZodNumber {
  let result = schema.type === 'integer' ? z.number().int() : z.number();

  if (schema.minimum !== undefined) {
    result = result.min(schema.minimum);
  }

  if (schema.maximum !== undefined) {
    result = result.max(schema.maximum);
  }

  if (schema.description) {
    result = result.describe(schema.description);
  }

  return result;
}

/**
 * Create an array schema
 */
function createArraySchema(schema: any): z.ZodTypeAny {
  let itemsSchema: z.ZodTypeAny;

  if (schema.items) {
    itemsSchema = jsonSchemaToZod(schema.items);
  } else {
    itemsSchema = z.any();
  }

  let result = z.array(itemsSchema);

  if (schema.minItems !== undefined) {
    result = result.min(schema.minItems);
  }

  if (schema.maxItems !== undefined) {
    result = result.max(schema.maxItems);
  }

  if (schema.description) {
    result = result.describe(schema.description);
  }

  return result;
}

/**
 * Create an object schema
 */
function createObjectSchema(schema: any): z.ZodTypeAny {
  const properties: Record<string, z.ZodTypeAny> = {};
  const requiredFields = new Set(schema.required || []);

  // Process properties
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      let fieldSchema = jsonSchemaToZod(propSchema);

      // Make field optional if not in required array
      if (!requiredFields.has(key)) {
        fieldSchema = fieldSchema.optional();
      }

      properties[key] = fieldSchema;
    }
  }

  let result = z.object(properties);

  if (schema.description) {
    result = result.describe(schema.description);
  }

  return result;
}

/**
 * Utility function to safely convert a schema to Zod
 *
 * This wraps jsonSchemaToZod with error handling to ensure the application
 * doesn't crash on invalid schemas.
 *
 * @param schema - JSON Schema definition
 * @param fallback - Optional fallback schema if conversion fails
 * @returns Zod schema
 */
export function safeConvertToZod(schema: any, fallback?: z.ZodTypeAny): z.ZodTypeAny {
  // Basic validation: if schema is not an object or lacks recognizable keys, return fallback
  if (schema === null || schema === undefined) {
    // null or undefined -> allow any
    return z.any();
  }
  if (typeof schema !== 'object') {
    return fallback || z.object({});
  }

  const hasKeys = Boolean(
    schema.type || schema.properties || schema.items || schema.anyOf || schema.oneOf || schema.allOf
  );
  if (!hasKeys) {
    return fallback || z.object({});
  }

  try {
    return jsonSchemaToZod(schema);
  } catch (error) {
    console.error('Failed to convert schema to Zod:', error);
    return fallback || z.object({});
  }
}
