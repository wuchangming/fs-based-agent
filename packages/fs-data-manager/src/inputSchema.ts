import { toJSONSchema } from 'zod';
import type { ZodError, ZodTypeAny } from 'zod';
import type { ExecutorInputFieldSchema, ExecutorInputFieldType, ExecutorInputSchema } from './types.js';

type JsonSchema = Record<string, unknown>;

function asObject(value: unknown): JsonSchema | null {
  return value && typeof value === 'object' ? (value as JsonSchema) : null;
}

function inferFieldType(prop: JsonSchema): ExecutorInputFieldType {
  if (Array.isArray(prop.enum)) return 'enum';
  const rawType = prop.type;
  if (rawType === 'string') return 'string';
  if (rawType === 'boolean') return 'boolean';
  if (rawType === 'integer' || rawType === 'number') return 'number';
  return 'json';
}

function parseFieldSchema(key: string, prop: JsonSchema, required: boolean): ExecutorInputFieldSchema | null {
  const type = inferFieldType(prop);
  const field: ExecutorInputFieldSchema = { key, type, required };

  if (typeof prop.description === 'string' && prop.description.trim()) {
    field.description = prop.description;
  }

  if (Object.prototype.hasOwnProperty.call(prop, 'default')) {
    field.defaultValue = prop.default;
  }

  if (type === 'enum' && Array.isArray(prop.enum) && prop.enum.every((v) => typeof v === 'string')) {
    field.enumValues = prop.enum as string[];
  }

  return field;
}

export function zodToExecutorInputSchema(schema: ZodTypeAny): ExecutorInputSchema | undefined {
  let json: JsonSchema | null = null;
  try {
    json = asObject(toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));
  } catch {
    return undefined;
  }
  if (!json) return undefined;

  if (json.type !== 'object') return undefined;
  const properties = asObject(json.properties);
  if (!properties) return undefined;

  const requiredSet = new Set(
    Array.isArray(json.required) ? json.required.filter((v): v is string => typeof v === 'string') : []
  );

  const allFields: ExecutorInputFieldSchema[] = [];
  for (const [key, prop] of Object.entries(properties)) {
    const propObj = asObject(prop);
    if (!propObj) continue;
    const field = parseFieldSchema(key, propObj, requiredSet.has(key));
    if (field) allFields.push(field);
  }

  // Prefer required fields first while keeping stable order.
  const requiredFields = allFields.filter((f) => f.required);
  const optionalFields = allFields.filter((f) => !f.required);
  const fields = [...requiredFields, ...optionalFields];

  return { type: 'object', fields };
}

export function formatZodError(error: ZodError): string {
  const issues = error.issues ?? [];
  if (!issues.length) return error.message;
  return issues
    .map((issue) => {
      const path = issue.path?.length ? issue.path.join('.') : '';
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}
