import { OpenAPI } from '@commercebear/openapi-types';
import { dummyLogger, Logger } from 'ts-log';

export interface IOpenAPIRequestCoercer {
  coerce(request: OpenAPI.Request): void;
}

export interface CoercionStrategy {
  boolean?: (input: any) => any;
  number?: (input: any) => any;
  integer?: (input: any) => any;
}

export interface OpenAPIRequestCoercerArgs {
  loggingKey?: string;
  logger?: Logger;
  extensionBase?: string;
  coercionStrategy?: CoercionStrategy;
  parameters: OpenAPI.Parameters;
}

export default class OpenAPIRequestCoercer implements IOpenAPIRequestCoercer {
  private coerceHeaders;
  private coerceParams;
  private coerceQuery;
  private coerceFormData;

  constructor(args: OpenAPIRequestCoercerArgs) {
    const loggingKey = args && args.loggingKey ? `${args.loggingKey}: ` : '';
    if (!args) {
      throw new Error(`${loggingKey}missing args argument`);
    }

    const logger = args.logger || dummyLogger;

    if (!Array.isArray(args.parameters)) {
      throw new Error(`${loggingKey}args.parameters must be an Array`);
    }

    if (!args.coercionStrategy) {
      args.coercionStrategy = {};
    }

    const extensionBase =
      args && args.extensionBase ? args.extensionBase : 'x-openapi-coercion';
    const strictExtensionName = `${extensionBase}-strict`;

    this.coerceHeaders = buildCoercer({
      params: args.parameters,
      property: 'header',
      isHeaders: true,
      logger,
      loggingKey,
      strictExtensionName,
      coercionStrategy: args.coercionStrategy,
    });
    this.coerceParams = buildCoercer({
      params: args.parameters,
      property: 'path',
      isHeaders: false,
      logger,
      loggingKey,
      strictExtensionName,
      coercionStrategy: args.coercionStrategy,
    });
    this.coerceQuery = buildCoercer({
      params: args.parameters,
      property: 'query',
      isHeaders: false,
      logger,
      loggingKey,
      strictExtensionName,
      coercionStrategy: args.coercionStrategy,
    });
    this.coerceFormData = buildCoercer({
      params: args.parameters,
      property: 'formData',
      isHeaders: false,
      logger,
      loggingKey,
      strictExtensionName,
      coercionStrategy: args.coercionStrategy,
    });
  }

  public coerce(request) {
    if (request.headers && this.coerceHeaders) {
      this.coerceHeaders(request.headers);
    }

    if (request.params && this.coerceParams) {
      this.coerceParams(request.params);
    }

    if (request.query && this.coerceQuery) {
      this.coerceQuery(request.query);
    }

    if (request.body && this.coerceFormData) {
      this.coerceFormData(request.body);
    }
  }
}

const COERCION_STRATEGIES = {
  array: (getCoercer, param, schema, input) => {
    if (!Array.isArray(input)) {
      let collectionFormat = param.collectionFormat;
      // OpenAPI 3.0 has replaced collectionFormat with a style property
      // https://github.com/OAI/OpenAPI-Specification/blob/master/versions/3.0.2.md#style-values
      if (param.style) {
        if (param.style === 'form' && param.in === 'query') {
          collectionFormat = param.explode ? 'multi' : 'csv';
        } else if (
          param.style === 'simple' &&
          (param.in === 'path' || param.in === 'header')
        ) {
          collectionFormat = 'csv';
        } else if (
          param.style === 'spaceDelimited' &&
          param.in === 'query'
        ) {
          collectionFormat = 'ssv';
        } else if (
          param.style === 'pipeDelimited' &&
          param.in === 'query'
        ) {
          collectionFormat = 'pipes';
        }
      }
      const sep = pathsep(collectionFormat || 'csv');
      input = input.split(sep);
    }

    return input.map((v, i) => {
      const itemSchema = schema.items.schema ? schema.items.schema : schema.items;
      return getCoercer(itemSchema.type)(getCoercer, param, itemSchema, v);
    });
  },

  object: (getCoercer, param, schema, input) => {
    if (typeof input !== 'object' || Array.isArray(input)) {
      return input;
    }

    for (const key of Object.keys(input)) {
      const propertySchema = schema.properties
        ? schema.properties[key]
        : schema.additionalProperties;
      if (propertySchema) {
        input[key] = getCoercer(propertySchema.type)(getCoercer, param, propertySchema, input[key]);
      }
    }

    return input;
  },

  boolean: (getCoercer, param, schema, input) => {
    if (typeof input === 'boolean') {
      return input;
    }

    if (input === 'false') {
      return false;
    } else {
      return true;
    }
  },

  integer: (getCoercer, param, schema, input) => {
    const result = Math.floor(Number(input));
    return isNaN(result) ? input : result;
  },

  number: (getCoercer, param, schema, input) => {
    const result = Number(input);
    return isNaN(result) ? input : result;
  },

  string: (getCoercer, param, schema, input) => String(input),
};

const STRICT_COERCION_STRATEGIES = {
  boolean: (getCoercer, param, schema, input) => {
    if (typeof input === 'boolean') {
      return input;
    }

    if (input.toLowerCase() === 'false') {
      return false;
    } else if (input.toLowerCase() === 'true') {
      return true;
    } else {
      return null;
    }
  },
};

function buildCoercer(args) {
  const l = args.isHeaders
    ? (name) => {
        return name.toLowerCase();
      }
    : (name) => {
        return name;
      };
  let coercion;

  if (args.params.length) {
    const coercers = {};

    args.params.filter(byLocation(args.property)).forEach((param) => {
      // OpenAPI (Swagger) 2.0 has type and format information as direct properties
      // of the param object. OpenAPI 3.0 has type and format information in a
      // schema object property. Use a schema value to normalize the change across
      // both versions so coercer works properly.
      const isSwaggerV2 = !!param.type;
      const schema = param.schema || param;
      const name = param.name;
      const type = schema.type;
      const strict = !!param[args.strictExtensionName];

      if (type === 'array') {
        if (!schema.items) {
          throw new Error(
            `${args.loggingKey}items is a required property with type array`
          );
        }

        if (
          schema.items.type === 'array' ||
          (schema.items.schema && schema.items.schema.type === 'array')
        ) {
          throw new Error(
            `${args.loggingKey}nested arrays are not allowed (items was of type array)`
          );
        }
      }

      const getCoercerLocal = getCoercer.bind(null, strict, args.logger, args.loggingKey, args.coercionStrategy);
      coercers[l(name)] = getCoercerLocal(type).bind(null, getCoercerLocal, param, schema);
    });

    coercion = (obj) => {
      for (const paramName in obj) {
        if (coercers.hasOwnProperty(paramName)) {
          obj[paramName] = coercers[paramName](obj[paramName]);
        }
      }
    };
  }

  return coercion;
}

function byLocation(location) {
  return (param) => param.in === location;
}

function identityCoercer(getCoercer: any, param: any, schema: any, input: any) {
  return input;
}

function getCoercer(
  strict: boolean,
  logger: Logger,
  loggingKey: string,
  customStrategy: CoercionStrategy,
  type: string,
) {
  let strategy;
  if (customStrategy[type] !== undefined) {
    strategy = (getCoercer, param, schema, input) => customStrategy[type](input);
  }
  if (strategy === undefined && strict) {
    strategy = STRICT_COERCION_STRATEGIES[type];
  }
  if (!strategy) {
    strategy = COERCION_STRATEGIES[type];
  }
  if (strategy === undefined) {
    const msg =
      type === undefined
        ? 'No type has been defined'
        : `No proper coercion strategy has been found for type '${type}'`;

    logger.warn(
      loggingKey,
      `${msg}. A default 'identity' strategy has been set.`
    );
    strategy = identityCoercer;
  }

  return strategy;
}

function pathsep(format) {
  switch (format) {
    case 'csv':
      return ',';
    case 'ssv':
      return ' ';
    case 'tsv':
      return '\t';
    case 'pipes':
      return '|';
  }
}
