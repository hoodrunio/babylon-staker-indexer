module.exports = {
  apps: [{
    name: 'babylon-staker-indexer',
    script: 'dist/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '4G',
    env: {
      NODE_ENV: 'production',
      PM2_USAGE: 'true'
    },
    kill_timeout: 600,      // Uygulamaya kapanması için 10 dakika ver
    wait_ready: true,        // process.send('ready') mesajını bekle
    listen_timeout: 6000,    // ready mesajı için maksimum bekleme süresi
    shutdown_with_message: true,  // shutdown mesajını gönder
    output: 'logs/pm2-out.log',    // stdout için log dosyası
    error: 'logs/pm2-error.log',   // stderr için log dosyası
    merge_logs: true,              // Tüm instance'ların loglarını birleştir
    log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS'  // Log zaman formatı
  }]
} 