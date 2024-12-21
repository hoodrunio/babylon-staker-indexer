import { OpenAPIV3 } from 'openapi-types';

export const swaggerDocument: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: {
    title: 'Babylon Staker Indexer API',
    version: '1.0.0',
    description: 'API documentation for the Babylon Staker Indexer service'
  },
  servers: [
    {
      url: 'http://localhost:3000/api',
      description: 'Local development server'
    }
  ],
  paths: {
    '/finality-providers': {
      get: {
        tags: ['Finality Providers'],
        summary: 'Get all finality providers',
        responses: {
          '200': {
            description: 'List of all finality providers',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        $ref: '#/components/schemas/FinalityProvider'
                      }
                    },
                    count: {
                      type: 'number'
                    },
                    timestamp: {
                      type: 'number'
                    }
                  }
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/Error500'
          }
        }
      }
    },
    '/finality-providers/top': {
      get: {
        tags: ['Finality Providers'],
        summary: 'Get top finality providers',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            description: 'Number of top providers to return',
            schema: {
              type: 'integer',
              default: 10
            }
          }
        ],
        responses: {
          '200': {
            description: 'List of top finality providers',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        $ref: '#/components/schemas/FinalityProvider'
                      }
                    },
                    count: {
                      type: 'number'
                    },
                    timestamp: {
                      type: 'number'
                    }
                  }
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/Error500'
          }
        }
      }
    },
    '/finality-providers/{address}': {
      get: {
        tags: ['Finality Providers'],
        summary: 'Get finality provider stats by address',
        parameters: [
          {
            name: 'address',
            in: 'path',
            required: true,
            description: 'Finality provider address',
            schema: {
              type: 'string'
            }
          },
          {
            name: 'from',
            in: 'query',
            description: 'Start timestamp for time range',
            schema: {
              type: 'number'
            }
          },
          {
            name: 'to',
            in: 'query',
            description: 'End timestamp for time range',
            schema: {
              type: 'number'
            }
          }
        ],
        responses: {
          '200': {
            description: 'Finality provider statistics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      $ref: '#/components/schemas/FinalityProviderStats'
                    },
                    timestamp: {
                      type: 'number'
                    }
                  }
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/Error500'
          }
        }
      }
    },
    '/stakers': {
      get: {
        tags: ['Stakers'],
        summary: 'Get top stakers',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            description: 'Number of top stakers to return',
            schema: {
              type: 'integer',
              default: 10
            }
          },
          {
            name: 'from',
            in: 'query',
            description: 'Start timestamp for time range',
            schema: {
              type: 'number'
            }
          },
          {
            name: 'to',
            in: 'query',
            description: 'End timestamp for time range',
            schema: {
              type: 'number'
            }
          }
        ],
        responses: {
          '200': {
            description: 'List of top stakers',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        $ref: '#/components/schemas/Staker'
                      }
                    }
                  }
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/Error500'
          }
        }
      }
    },
    '/stakers/{address}': {
      get: {
        tags: ['Stakers'],
        summary: 'Get staker stats by address',
        parameters: [
          {
            name: 'address',
            in: 'path',
            required: true,
            description: 'Staker address',
            schema: {
              type: 'string'
            }
          },
          {
            name: 'from',
            in: 'query',
            description: 'Start timestamp for time range',
            schema: {
              type: 'number'
            }
          },
          {
            name: 'to',
            in: 'query',
            description: 'End timestamp for time range',
            schema: {
              type: 'number'
            }
          }
        ],
        responses: {
          '200': {
            description: 'Staker statistics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      $ref: '#/components/schemas/StakerStats'
                    }
                  }
                }
              }
            }
          },
          '404': {
            description: 'Staker not found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: {
                      type: 'string'
                    },
                    details: {
                      type: 'string'
                    }
                  }
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/Error500'
          }
        }
      }
    },
    '/versions/{version}': {
      get: {
        tags: ['Versions'],
        summary: 'Get version statistics',
        parameters: [
          {
            name: 'version',
            in: 'path',
            required: true,
            description: 'Version number',
            schema: {
              type: 'number'
            }
          },
          {
            name: 'from',
            in: 'query',
            description: 'Start timestamp for time range',
            schema: {
              type: 'number'
            }
          },
          {
            name: 'to',
            in: 'query',
            description: 'End timestamp for time range',
            schema: {
              type: 'number'
            }
          }
        ],
        responses: {
          '200': {
            description: 'Version statistics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      $ref: '#/components/schemas/VersionStats'
                    }
                  }
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/Error500'
          }
        }
      }
    },
    '/stats': {
      get: {
        tags: ['Global Stats'],
        summary: 'Get global statistics',
        responses: {
          '200': {
            description: 'Global statistics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      $ref: '#/components/schemas/GlobalStats'
                    }
                  }
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/Error500'
          }
        }
      }
    },
    '/phases': {
      get: {
        tags: ['Phases'],
        summary: 'Get all phase statistics',
        responses: {
          '200': {
            description: 'All phase statistics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        $ref: '#/components/schemas/PhaseStats'
                      }
                    }
                  }
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/Error500'
          }
        }
      }
    },
    '/phases/{phase}': {
      get: {
        tags: ['Phases'],
        summary: 'Get statistics for a specific phase',
        parameters: [
          {
            name: 'phase',
            in: 'path',
            required: true,
            description: 'Phase number',
            schema: {
              type: 'number'
            }
          }
        ],
        responses: {
          '200': {
            description: 'Phase statistics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      $ref: '#/components/schemas/PhaseStats'
                    }
                  }
                }
              }
            }
          },
          '404': {
            description: 'Phase not found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: {
                      type: 'string'
                    }
                  }
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/Error500'
          }
        }
      }
    }
  },
  components: {
    schemas: {
      FinalityProvider: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description: 'Finality provider address'
          },
          totalStake: {
            type: 'string',
            description: 'Total stake amount'
          }
        }
      },
      FinalityProviderStats: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description: 'Finality provider address'
          },
          stats: {
            type: 'object',
            description: 'Provider statistics'
          }
        }
      },
      Staker: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description: 'Staker address'
          },
          totalStake: {
            type: 'string',
            description: 'Total stake amount'
          }
        }
      },
      StakerStats: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description: 'Staker address'
          },
          stats: {
            type: 'object',
            description: 'Staker statistics'
          }
        }
      },
      VersionStats: {
        type: 'object',
        properties: {
          version: {
            type: 'number',
            description: 'Version number'
          },
          stats: {
            type: 'object',
            description: 'Version statistics'
          }
        }
      },
      GlobalStats: {
        type: 'object',
        properties: {
          totalStake: {
            type: 'string',
            description: 'Total stake in the system'
          },
          totalStakers: {
            type: 'number',
            description: 'Total number of stakers'
          },
          totalFinalityProviders: {
            type: 'number',
            description: 'Total number of finality providers'
          }
        }
      },
      PhaseStats: {
        type: 'object',
        properties: {
          phase: {
            type: 'number',
            description: 'Phase number'
          },
          stats: {
            type: 'object',
            description: 'Phase statistics'
          }
        }
      }
    },
    responses: {
      Error500: {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: {
                  type: 'string',
                  description: 'Error message'
                }
              }
            }
          }
        }
      }
    }
  }
};
