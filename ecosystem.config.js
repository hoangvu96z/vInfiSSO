module.exports = {
  apps: [
    {
      name: 'vinfisso',
      script: './dist/main.js',
      instances: 'max',
      exec_mode: 'cluster',
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'dist'],
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],

  // Deploy configuration
  deploy: {
    production: {
      user: 'root',
      host: 'sso.vunph.click',
      ref: 'origin/main',
      repo: 'https://github.com/hoangvu96z/vInfiSSO.git',
      path: '/opt/vinfisso',
      'post-deploy':
        'npm install && npm run build && pm2 restart ecosystem.config.js --env production',
      'pre-deploy-local': 'echo "Deploying to production..."',
    },
  },
};
