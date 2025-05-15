module.exports = {
  apps: [{
    name: 'babylon-staker-indexer',
    script: 'dist/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '8G',
    env: {
      NODE_ENV: 'production',
      PM2_USAGE: 'true'
    },
    kill_timeout: 30,      // Give application 10 minutes to shutdown
    wait_ready: true,        // Wait for process.send('ready') message
    listen_timeout: 6000,    // Maximum wait time for ready message
    shutdown_with_message: true,  // Send shutdown message
    output: 'logs/pm2-out.log',    // Log file for stdout
    error: 'logs/pm2-error.log',   // Log file for stderr
    merge_logs: true,              // Merge logs from all instances
    log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS'  // Log time format
  }]
} 