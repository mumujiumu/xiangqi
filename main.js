/*
 * Electron 主进程 · 中国象棋
 * 启动一个 BrowserWindow 加载 index.html
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 780,
        minWidth: 900,
        minHeight: 700,
        title: '中国象棋 · 楚河汉界',
        autoHideMenuBar: true,
        backgroundColor: '#1a1a2e',
        icon: path.join(__dirname, 'build', 'icon.png'),
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile('index.html');

    // 外部链接用系统浏览器打开
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        // macOS 点击 dock 图标时重新创建窗口
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    // macOS 上窗口关闭后应用保持活跃
    if (process.platform !== 'darwin') app.quit();
});
