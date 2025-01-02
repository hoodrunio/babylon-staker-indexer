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
      url: 'https://bbn-indexer.hoodscan.io/api',
      description: 'Production server'
    },
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
        parameters: [
          {
            name: 'page',
            in: 'query',
            description: 'Page number',
            schema: {
              type: 'integer',
              default: 1
            }
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Number of items per page',
            schema: {
              type: 'integer',
              default: 10
            }
          },
          {
            name: 'sort_by',
            in: 'query',
            description: 'Field to sort by',
            schema: {
              type: 'string',
              default: 'totalStake',
              enum: ['totalStake', 'transactionCount', 'uniqueStakers', 'createdAt', 'updatedAt']
            }
          },
          {
            name: 'order',
            in: 'query',
            description: 'Sort order',
            schema: {
              type: 'string',
              default: 'desc',
              enum: ['asc', 'desc']
            }
          },
          {
            name: 'include_stakers',
            in: 'query',
            description: 'Include staker details in response',
            schema: {
              type: 'boolean',
              default: false
            }
          },
          {
            name: 'stakers_page',
            in: 'query',
            description: 'Page number for stakers list (only when include_stakers=true)',
            schema: {
              type: 'integer',
              default: 1
            }
          },
          {
            name: 'stakers_limit',
            in: 'query',
            description: 'Number of stakers per page (only when include_stakers=true)',
            schema: {
              type: 'integer',
              default: 50
            }
          }
        ],
        responses: {
          '200': {
            description: 'List of finality providers',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        $ref: '#/components/schemas/FinalityProviderStats'
                      }
                    },
                    timestamp: {
                      type: 'number'
                    },
                    meta: {
                      type: 'object',
                      properties: {
                        pagination: {
                          type: 'object',
                          properties: {
                            page: {
                              type: 'number'
                            },
                            limit: {
                              type: 'number'
                            },
                            totalPages: {
                              type: 'number'
                            },
                            totalCount: {
                              type: 'number'
                            },
                            hasMore: {
                              type: 'boolean'
                            }
                          }
                        },
                        stakers: {
                          type: 'object',
                          nullable: true,
                          properties: {
                            page: {
                              type: 'number'
                            },
                            limit: {
                              type: 'number'
                            }
                          }
                        }
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
    '/finality-providers/top': {
      get: {
        tags: ['Finality Providers'],
        summary: 'Get top finality providers',
        parameters: [
          {
            name: 'page',
            in: 'query',
            description: 'Page number',
            schema: {
              type: 'integer',
              default: 1
            }
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Number of items per page',
            schema: {
              type: 'integer',
              default: 10
            }
          },
          {
            name: 'sort_by',
            in: 'query',
            description: 'Field to sort by',
            schema: {
              type: 'string',
              default: 'totalStake',
              enum: ['totalStake', 'transactionCount', 'uniqueStakers', 'createdAt', 'updatedAt']
            }
          },
          {
            name: 'order',
            in: 'query',
            description: 'Sort order',
            schema: {
              type: 'string',
              default: 'desc',
              enum: ['asc', 'desc']
            }
          },
          {
            name: 'include_stakers',
            in: 'query',
            description: 'Include staker details in response',
            schema: {
              type: 'boolean',
              default: false
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
                        $ref: '#/components/schemas/FinalityProviderStats'
                      }
                    },
                    metadata: {
                      type: 'object',
                      properties: {
                        currentPage: {
                          type: 'number'
                        },
                        totalPages: {
                          type: 'number'
                        },
                        totalItems: {
                          type: 'number'
                        },
                        itemsPerPage: {
                          type: 'number'
                        }
                      }
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
          },
          {
            name: 'page',
            in: 'query',
            description: 'Page number for stakers list',
            schema: {
              type: 'integer',
              default: 1
            }
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Number of stakers per page',
            schema: {
              type: 'integer',
              default: 50
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
                    },
                    meta: {
                      type: 'object',
                      properties: {
                        pagination: {
                          type: 'object',
                          properties: {
                            page: {
                              type: 'number'
                            },
                            limit: {
                              type: 'number'
                            },
                            totalPages: {
                              type: 'number'
                            },
                            totalCount: {
                              type: 'number'
                            },
                            hasMore: {
                              type: 'boolean'
                            }
                          }
                        },
                        timeRange: {
                          type: 'object',
                          nullable: true,
                          properties: {
                            from: {
                              type: 'number'
                            },
                            to: {
                              type: 'number'
                            },
                            duration: {
                              type: 'number'
                            }
                          }
                        }
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
    '/stakers': {
      get: {
        tags: ['Stakers'],
        summary: 'Get all stakers',
        parameters: [
          {
            name: 'page',
            in: 'query',
            description: 'Page number',
            schema: {
              type: 'integer',
              default: 1
            }
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Number of items per page',
            schema: {
              type: 'integer',
              default: 10
            }
          },
          {
            name: 'sort_by',
            in: 'query',
            description: 'Field to sort by',
            schema: {
              type: 'string',
              default: 'totalStake',
              enum: ['totalStake', 'transactionCount', 'activeStakes', 'createdAt', 'updatedAt']
            }
          },
          {
            name: 'order',
            in: 'query',
            description: 'Sort order',
            schema: {
              type: 'string',
              default: 'desc',
              enum: ['asc', 'desc']
            }
          },
          {
            name: 'include_transactions',
            in: 'query',
            description: 'Include transaction details in response',
            schema: {
              type: 'boolean',
              default: false
            }
          },
          {
            name: 'transactions_page',
            in: 'query',
            description: 'Page number for transactions list (only when include_transactions=true)',
            schema: {
              type: 'integer',
              default: 1
            }
          },
          {
            name: 'transactions_limit',
            in: 'query',
            description: 'Number of transactions per page (only when include_transactions=true)',
            schema: {
              type: 'integer',
              default: 50
            }
          }
        ],
        responses: {
          '200': {
            description: 'List of all stakers',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        $ref: '#/components/schemas/StakerStats'
                      }
                    },
                    timestamp: {
                      type: 'number'
                    },
                    meta: {
                      type: 'object',
                      properties: {
                        pagination: {
                          type: 'object',
                          properties: {
                            page: {
                              type: 'number'
                            },
                            limit: {
                              type: 'number'
                            },
                            totalPages: {
                              type: 'number'
                            },
                            totalCount: {
                              type: 'number'
                            },
                            hasMore: {
                              type: 'boolean'
                            }
                          }
                        },
                        transactions: {
                          type: 'object',
                          nullable: true,
                          properties: {
                            page: {
                              type: 'number'
                            },
                            limit: {
                              type: 'number'
                            }
                          }
                        }
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
          },
          {
            name: 'include_transactions',
            in: 'query',
            description: 'Include transaction details in response',
            schema: {
              type: 'boolean',
              default: false
            }
          },
          {
            name: 'page',
            in: 'query',
            description: 'Page number for transactions list (only when include_transactions=true)',
            schema: {
              type: 'integer',
              default: 1
            }
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Number of transactions per page (only when include_transactions=true)',
            schema: {
              type: 'integer',
              default: 50
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
                    },
                    timestamp: {
                      type: 'number'
                    },
                    meta: {
                      type: 'object',
                      properties: {
                        pagination: {
                          type: 'object',
                          nullable: true,
                          properties: {
                            page: {
                              type: 'number'
                            },
                            limit: {
                              type: 'number'
                            },
                            totalPages: {
                              type: 'number'
                            },
                            totalCount: {
                              type: 'number'
                            },
                            hasMore: {
                              type: 'boolean'
                            }
                          }
                        },
                        timeRange: {
                          type: 'object',
                          nullable: true,
                          properties: {
                            from: {
                              type: 'number'
                            },
                            to: {
                              type: 'number'
                            },
                            duration: {
                              type: 'number'
                            }
                          }
                        }
                      }
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
            type: 'string'
          },
          totalStake: {
            type: 'string'
          },
          createdAt: {
            type: 'number'
          },
          updatedAt: {
            type: 'number'
          },
          totalStakeBTC: {
            type: 'number'
          },
          transactionCount: {
            type: 'number'
          },
          uniqueStakers: {
            type: 'number'
          },
          uniqueBlocks: {
            type: 'number'
          },
          timeRange: {
            type: 'object',
            properties: {
              firstTimestamp: {
                type: 'number'
              },
              lastTimestamp: {
                type: 'number'
              },
              durationSeconds: {
                type: 'number'
              }
            }
          },
          averageStakeBTC: {
            type: 'number'
          },
          versionsUsed: {
            type: 'array',
            items: {
              type: 'number'
            }
          },
          stakerAddresses: {
            type: 'array',
            items: {
              type: 'string'
            }
          },
          stats: {
            type: 'object'
          },
          phaseStakes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                phase: {
                  type: 'number'
                },
                totalStake: {
                  type: 'number'
                },
                transactionCount: {
                  type: 'number'
                },
                stakerCount: {
                  type: 'number'
                },
                stakers: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      address: {
                        type: 'string'
                      },
                      stake: {
                        type: 'number'
                      }
                    }
                  }
                }
              },
              required: ['phase', 'totalStake', 'transactionCount', 'stakerCount']
            }
          }
        },
        required: ['address', 'totalStake', 'totalStakeBTC', 'transactionCount', 'uniqueStakers', 'uniqueBlocks', 'timeRange', 'averageStakeBTC', 'versionsUsed', 'stats', 'phaseStakes', 'createdAt', 'updatedAt']
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
            type: 'string'
          },
          stakerPublicKey: {
            type: 'string',
            description: 'Public key of the staker'
          },
          totalStake: {
            type: 'string'
          },
          totalStakeBTC: {
            type: 'number'
          },
          transactionCount: {
            type: 'number'
          },
          uniqueProviders: {
            type: 'number'
          },
          uniqueBlocks: {
            type: 'number'
          },
          timeRange: {
            type: 'object',
            properties: {
              firstTimestamp: {
                type: 'number'
              },
              lastTimestamp: {
                type: 'number'
              },
              durationSeconds: {
                type: 'number'
              }
            }
          },
          averageStakeBTC: {
            type: 'number'
          },
          versionsUsed: {
            type: 'array',
            items: {
              type: 'number'
            }
          },
          finalityProviders: {
            type: 'array',
            items: {
              type: 'string'
            }
          },
          activeStakes: {
            type: 'number'
          },
          stats: {
            type: 'object'
          },
          phaseStakes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                phase: {
                  type: 'number'
                },
                totalStake: {
                  type: 'number'
                },
                transactionCount: {
                  type: 'number'
                },
                finalityProviders: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      address: {
                        type: 'string'
                      },
                      stake: {
                        type: 'number'
                      }
                    }
                  }
                }
              },
              required: ['phase', 'totalStake', 'transactionCount']
            }
          },
          transactions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                phase: {
                  type: 'number'
                },
                transactions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      txid: {
                        type: 'string'
                      },
                      timestamp: {
                        type: 'number'
                      },
                      amount: {
                        type: 'number'
                      },
                      amountBTC: {
                        type: 'number'
                      },
                      finalityProvider: {
                        type: 'string'
                      }
                    },
                    required: ['txid', 'timestamp', 'amount', 'amountBTC', 'finalityProvider']
                  }
                }
              },
              required: ['phase', 'transactions']
            }
          }
        },
        required: ['address', 'totalStake', 'totalStakeBTC', 'transactionCount', 'uniqueProviders', 'uniqueBlocks', 'timeRange', 'averageStakeBTC', 'versionsUsed', 'stats', 'phaseStakes', 'finalityProviders', 'activeStakes']
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
