const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, 'logs');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFilePath() {
  return path.join(LOG_DIR, `redis-operator-${new Date().toISOString().split('T')[0]}.log`);
}

function formatTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 23);
}

function writeLog(level, message, ...args) {
  const timestamp = formatTimestamp();
  const pid = process.pid;
  let logMessage = `[${timestamp}] [${level.toUpperCase()}] [PID:${pid}] ${message}`;
  
  if (args.length > 0) {
    try {
      logMessage += ' ' + JSON.stringify(args);
    } catch {
      logMessage += ' ' + args.map(a => String(a)).join(' ');
    }
  }

  const filePath = getLogFilePath();
  try {
    fs.appendFileSync(filePath, logMessage + '\n', 'utf8');
  } catch (err) {
    console.error('Failed to write log:', err.message);
  }

  if (level === 'error' || level === 'warn') {
    console.error(logMessage);
  } else {
    console.log(logMessage);
  }
}

module.exports = {
  info: (message, ...args) => writeLog('info', message, ...args),
  warn: (message, ...args) => writeLog('warn', message, ...args),
  error: (message, ...args) => writeLog('error', message, ...args),
  debug: (message, ...args) => writeLog('debug', message, ...args),
  getLogDir: () => LOG_DIR,
};
