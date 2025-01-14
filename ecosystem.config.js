module.exports = {
  apps: [{
    name: 'babylon-staker-indexer',
    script: 'dist/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '4G',
    env: {
      NODE_ENV: 'production'
    }
  }]
} 