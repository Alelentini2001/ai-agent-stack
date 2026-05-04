// PM2 ecosystem — run with: pm2 start ecosystem.config.cjs
// Install PM2:  npm install -g pm2
// Auto-restart: pm2 startup && pm2 save
module.exports = {
  apps: [
    {
      name: "approval-gate",
      script: "dist/index.js",
      interpreter: "node",
      env_file: ".env",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      restart_delay: 3000,
      max_restarts: 20,
      min_uptime: "10s",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "data/pm2-error.log",
      out_file: "data/pm2-out.log",
      merge_logs: true,
    },
  ],
};
