module.exports = {
  args: {
    parameters: [
      {
        in: 'query',
        schema: {
          type: 'array',
          items: {
            schema: {
              type: 'object',
              properties: {
                number: { type: 'number' },
                string: { type: 'string' },
              },
            },
          },
        },
        name: 'arrayOfObjects',
        required: false,
      },
      {
        in: 'query',
        schema: {
          type: 'object',
          properties: {
            number: { type: 'number' },
            string: { type: 'string' },
          },
        },
        name: 'object',
        required: false,
      },
      {
        in: 'query',
        schema: {
          type: 'object',
          additionalProperties: {
            type: 'number',
          },
        },
        name: 'additionalProperties',
        required: false,
      },
    ],
  },

  request: {
    query: {
      arrayOfObjects: [
        { number: '1', string: '1' },
        { number: '2', string: '2' },
      ],
      object: { number: '3', string: '3' },
      additionalProperties: {
        width: '1',
        length: '2',
      },
    },
  },

  query: {
    arrayOfObjects: [
      { number: 1, string: '1' },
      { number: 2, string: '2' },
    ],
    object: { number: 3, string: '3' },
    additionalProperties: { width: 1, length: 2 },
  },
};
