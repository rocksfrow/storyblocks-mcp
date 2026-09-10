'use strict';

/*
 * Minimal JSON Schema validator covering the subset used by this server's tool
 * schemas: type, enum, const, properties/required/additionalProperties, items,
 * minItems/maxItems, minimum/maximum, minLength, pattern, anyOf, format (email, uri).
 *
 * Returns a list of human-readable error strings; empty means valid.
 * Also applies `default` values for missing object properties (mutates `value`).
 */

const FORMATS = {
  email: (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
  uri: (s) => {
    try {
      new URL(s);
      return true;
    } catch (_) {
      return false;
    }
  },
};

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value, type) {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeOf(value) === type;
}

/**
 * @param {object} schema
 * @param {unknown} value
 * @param {string} [path]
 * @returns {string[]} errors
 */
function validate(schema, value, path = 'arguments') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.anyOf) {
    const ok = schema.anyOf.some((sub) => validate(sub, value, path).length === 0);
    if (!ok) errors.push(`${path}: does not match any allowed form`);
    return errors;
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path}: expected ${types.join(' or ')}, got ${typeOf(value)}`);
      return errors;
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: must be at least ${schema.minLength} character(s)`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: ${schema.patternDescription || `must match ${schema.pattern}`}`);
    }
    if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format](value)) {
      errors.push(`${path}: must be a valid ${schema.format}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: must have at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: must have at most ${schema.maxItems} item(s)`);
    if (schema.items) value.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
  }

  if (typeOf(value) === 'object') {
    const props = schema.properties || {};
    for (const key of schema.required || []) {
      if (value[key] === undefined) errors.push(`${path}.${key}: is required`);
    }
    for (const [key, sub] of Object.entries(props)) {
      if (value[key] === undefined) {
        if (sub && sub.default !== undefined) value[key] = sub.default;
        continue;
      }
      errors.push(...validate(sub, value[key], `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) errors.push(`${path}.${key}: unknown parameter`);
      }
    }
  }

  return errors;
}

module.exports = { validate };
