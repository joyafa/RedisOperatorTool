const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow;
let serverProcess = null;
let loadRetryCount = 0;
const MAX_LOAD_RETRIES = 10;
let windowLoaded = false;
let isLoadingURL = false;

const userDataPath = app.getPath('userData');
const logDir = path.join(userDataPath, 'logs');

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logger = isPackaged()
  ? require(path.join(process.resourcesPath, 'logger'))
  : require('../logger');

function isPackaged() {
  return app.isPackaged;
}

function getServerPath() {
  if (isPackaged()) {
    return path.join(process.resourcesPath, 'server.js');
  }
  return path.join(__dirname, '..', 'server.js');
}

function checkServerReady(callback) {
  const req = http.request({
    hostname: '127.0.0.1',
    port: 3210,
    path: '/',
    method: 'GET',
    timeout: 2000
  }, (res) => {
    callback(true);
  });

  req.on('error', () => {
    callback(false);
  });

  req.on('timeout', () => {
    req.destroy();
    callback(false);
  });

  req.end();
}

function createWindow() {
  logger.info('Creating main window');
  
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 850,
    minWidth: 1000,
    minHeight: 600,
    title: 'Redis Operator',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  loadRetryCount = 0;
  windowLoaded = false;
  attemptLoadWindow();

  mainWindow.on('closed', () => {
    logger.info('Main window closed');
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    logger.info('Window loaded successfully');
    windowLoaded = true;
    isLoadingURL = false;
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    logger.error('Window load failed:', errorCode, errorDescription);
    isLoadingURL = false;
    if (!windowLoaded) {
      attemptLoadWindow();
    }
  });

  mainWindow.webContents.on('crashed', () => {
    logger.error('Renderer process crashed');
    windowLoaded = false;
  });
}

function attemptLoadWindow() {
  if (!mainWindow) return;
  if (windowLoaded) return;
  if (isLoadingURL) return;

  checkServerReady((ready) => {
    if (ready && !windowLoaded && !isLoadingURL) {
      logger.info('Server is ready, loading window');
      isLoadingURL = true;
      mainWindow.loadURL('http://127.0.0.1:3210');
      loadRetryCount = 0;
    } else if (!ready && !windowLoaded) {
      loadRetryCount++;
      if (loadRetryCount < MAX_LOAD_RETRIES) {
        const delay = loadRetryCount * 500;
        logger.info(`Server not ready, retrying in ${delay}ms (attempt ${loadRetryCount}/${MAX_LOAD_RETRIES})`);
        setTimeout(attemptLoadWindow, delay);
      } else {
        logger.error('Server failed to start after multiple attempts');
        dialog.showMessageBox({
          type: 'error',
          title: '启动失败',
          message: '无法启动服务',
          detail: 'Redis Operator 服务启动失败，请检查日志文件或重新安装应用。',
        }).then(() => {
          app.quit();
        });
      }
    }
  });
}

function startServer() {
  const { fork } = require('child_process');
  const serverPath = getServerPath();

  logger.info('Starting server process:', serverPath);
  logger.info('Packaged mode:', isPackaged());
  logger.info('Log directory:', logDir);

  if (!fs.existsSync(serverPath)) {
    logger.error('Server file not found:', serverPath);
    dialog.showMessageBox({
      type: 'error',
      title: '文件缺失',
      message: '服务器文件缺失',
      detail: `无法找到服务器文件: ${serverPath}\n请重新安装应用。`,
    }).then(() => {
      app.quit();
    });
    return;
  }

  const resourcesPath = isPackaged() ? process.resourcesPath : path.dirname(__dirname);
  
  serverProcess = fork(serverPath, [], {
    env: { 
      ...process.env, 
      PORT: '3210',
      NODE_ENV: isPackaged() ? 'production' : 'development',
      APP_IS_PACKAGED: String(isPackaged()),
      RESOURCES_PATH: resourcesPath,
      LOG_DIR: logDir,
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });

  serverProcess.stdout.on('data', (data) => {
    logger.info(`[server] ${data.toString().trim()}`);
  });

  serverProcess.stderr.on('data', (data) => {
    logger.error(`[server] ${data.toString().trim()}`);
  });

  serverProcess.on('exit', (code) => {
    logger.info(`[server] exited with code ${code}`);
    serverProcess = null;
    if (code !== 0 && mainWindow) {
      dialog.showMessageBox({
        type: 'error',
        title: '服务异常',
        message: '服务器进程异常退出',
        detail: `进程退出码: ${code}\n应用将关闭，请检查日志文件。`,
      }).then(() => {
        app.quit();
      });
    }
  });

  serverProcess.on('error', (err) => {
    logger.error(`[server] error:`, err.message);
    dialog.showMessageBox({
      type: 'error',
      title: '启动失败',
      message: '无法启动服务器进程',
      detail: `错误: ${err.message}\n请检查 Node.js 是否正确安装。`,
    }).then(() => {
      app.quit();
    });
  });
}

function stopServer() {
  if (serverProcess) {
    logger.info('Stopping server process');
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { role: 'reload', label: 'Reload Page' },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select All' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools', label: 'Developer Tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Reset Zoom' },
        { role: 'zoomIn', label: 'Zoom In' },
        { role: 'zoomOut', label: 'Zoom Out' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Full Screen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'About Redis Operator',
              message: 'Redis Operator v1.1.0',
              detail: 'A lightweight Redis data management tool.\n\nSupported data types:\nString, List, Hash, Set, ZSet, Stream,\nBitmap, HyperLogLog, GEO, JSON, TimeSeries\n\nCopyright © 2026 南昌市星纬智创科技有限公司.\nAll rights reserved.',
            });
          },
        },
        {
          label: '功能说明',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: '功能说明',
              message: 'Redis Operator 功能介绍',
              detail: `连接管理\n• 支持连接多个Redis实例\n• 支持密码认证\n• 支持切换16个数据库\n\n数据查看\n• 按前缀搜索Key\n• 分页加载Key列表\n• 查看Key类型和过期时间\n\n数据操作\n• String: 查看、编辑、设置过期\n• List: 头部/尾部添加、删除、按索引编辑\n• Hash: 添加、编辑、删除字段\n• Set: 添加、删除成员\n• ZSet: 添加、删除成员(带分数)\n• Stream: 查看消息流\n\n批量操作\n• 批量删除Key\n• 批量重命名Key\n\n安全特性\n• 生产环境安全限制\n• 大Key分页加载\n• 操作日志记录`,
            });
          },
        },
        {
          label: 'View Logs',
          click: () => {
            const { shell } = require('electron');
            shell.openPath(logDir);
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  logger.info('Redis Operator application starting');
  logger.info('App path:', app.getAppPath());
  logger.info('User data path:', userDataPath);
  
  createMenu();
  startServer();

  setTimeout(() => {
    createWindow();
  }, 500);
});

app.on('window-all-closed', () => {
  logger.info('All windows closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  logger.info('Application quitting');
  stopServer();
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err.message, err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection:', reason.message || reason);
});
