#!/bin/bash

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd /Users/leeson/Desktop/投资管理系统/Investrask/I

echo "=== Starting news-cron at $(date) ===" >> /Users/leeson/Library/Logs/investrack-news-cron.log
npm run news-cron >> /Users/leeson/Library/Logs/investrack-news-cron.log 2>&1
echo "=== Finished news-cron at $(date) ===" >> /Users/leeson/Library/Logs/investrack-news-cron.log