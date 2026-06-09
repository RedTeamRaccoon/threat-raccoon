'use strict';

import { app, protocol, BrowserWindow, Menu, ipcMain, safeStorage } from 'electron';
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib';
import installExtension, { VUEJS_DEVTOOLS } from 'electron-devtools-installer';
import menu from './menu.js';
import logger from './logger.js';
import { createKeyStore } from './keyStore.js';
import { createLlmRelay } from './llm.js';
import { electronURL, isDevelopment, isTest, isMacOS, isWin } from './utils.js';

const fs = require('fs');

const { autoUpdater } = require('electron-updater');
const path = require('path');

export function registerDesktop (deps) {
    const {
        app,
        protocol,
        BrowserWindow: BrowserWindowCtor,
        Menu: MenuApi,
        ipcMain: ipcMainApi,
        menu: menuApi,
        logger: loggerApi,
        utils,
        createProtocol: createProtocolFn,
        installExtension: installExtensionFn,
        VUEJS_DEVTOOLS: devtoolsId,
        autoUpdater: autoUpdaterApi,
        path: pathModule
    } = deps;

    const { electronURL: url, isDevelopment: isDev, isTest: testMode, isMacOS: macos, isWin: win } = utils;

    let runApp = true;
    let activeWindow = null;
    let streamController = null;

    const sendStreamEvent = (evt) => {
        if (activeWindow && (!activeWindow.isDestroyed || !activeWindow.isDestroyed())) {
            activeWindow.webContents.send('llm-stream-event', evt);
        }
    };

    // Wire the BYO-key LLM relay + settings storage for desktop mode. Guarded so a
    // missing safeStorage/userData (e.g. under unit tests) never blocks app startup.
    function registerLlmIpc () {
        if (typeof ipcMainApi.handle !== 'function') {
            return;
        }
        let keyStore;
        try {
            keyStore = createKeyStore({ app, safeStorage, fs, path: pathModule });
        } catch (e) {
            loggerApi.log.error('LLM key store unavailable: ' + e.toString());
            return;
        }
        const relay = createLlmRelay({ getKey: (provider) => keyStore.getKey(provider) });

        ipcMainApi.handle('llm-get-settings', () => keyStore.getSettings());
        ipcMainApi.handle('llm-set-settings', (_event, settings) => {
            keyStore.setSettings(settings);
            return true;
        });
        ipcMainApi.handle('llm-get-providers', () => keyStore.configuredProviders());
        ipcMainApi.handle('llm-set-key', (_event, provider, key) => {
            keyStore.setKey(provider, key);
            return true;
        });
        ipcMainApi.handle('llm-has-key', (_event, provider) => keyStore.hasKey(provider));

        ipcMainApi.on('llm-stream-start', async (_event, request) => {
            if (streamController) {
                streamController.abort();
            }
            streamController = new AbortController();
            await relay.streamCompletion(request, sendStreamEvent, streamController.signal);
        });
        ipcMainApi.on('llm-stream-abort', () => {
            if (streamController) {
                streamController.abort();
            }
            streamController = null;
        });
    }

    async function createWindow () {
        const mainWindow = new BrowserWindowCtor({
            width: 1400,
            height: 1000,
            show: false,
            webPreferences: {
                enableRemoteModule: false,
                nodeIntegration: false,
                contextIsolation: true,
                preload: pathModule.join(__static, 'preload.js')
            }
        });

        activeWindow = mainWindow;

        // Event listeners on the window
        mainWindow.webContents.on('did-finish-load', () => {
            mainWindow.show();
            mainWindow.focus();
            // menu system needs to access the main window
            menuApi.setMainWindow(mainWindow);
        });

        mainWindow.on('close', (event) => {
            if (runApp) {
                event.preventDefault();
                mainWindow.webContents.send('close-app-request');
            }
        });

        if (url) {
            loggerApi.log.info('Running in development mode with WEBPACK_DEV_SERVER_URL: ' + url);
            // Load the url of the dev server when in development mode
            await mainWindow.loadURL(url);
            if (!testMode) {
                mainWindow.webContents.openDevTools();
            }
        } else {
            createProtocolFn('app');
            // Load the index.html when not in development mode
            mainWindow.loadURL('app://./index.html');
        }
    }

    // Scheme must be registered before the app is ready
    protocol.registerSchemesAsPrivileged([
        { scheme: 'app', privileges: { secure: true, standard: true } }
    ]);

    // Quit when all windows are closed.
    app.on('window-all-closed', () => {
        // On macOS it is common for applications and their menu bar
        // to stay active until the user quits explicitly with Cmd + Q
        if (!macos) {
            loggerApi.log.debug('Quit application');
            app.quit();
        } else {
            loggerApi.log.debug('Ignoring window-all-closed for MacOS');
        }
    });

    app.on('activate', () => {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        loggerApi.log.debug('Activate application');
        if (BrowserWindowCtor.getAllWindows().length === 0) {
            createWindow();
        }
    });

    // This method will be called when Electron has finished initialization
    // and is ready to create browser windows
    // Some APIs can only be used after this event occurs.
    app.on('ready', async () => {
        loggerApi.log.debug('Building the menu system for the default language');
        const template = menuApi.getMenuTemplate();
        MenuApi.setApplicationMenu(MenuApi.buildFromTemplate(template));

        // Install Vue Devtools
        if (isDev && !testMode) {
            try {
                await installExtensionFn(devtoolsId);
            } catch (e) {
                loggerApi.log.error('Vue Devtools failed to install:', e.toString());
            }
        }

        ipcMainApi.on('close-app', handleCloseApp);
        ipcMainApi.on('model-closed', handleModelClosed);
        ipcMainApi.on('model-open-confirmed', handleModelOpenConfirmed);
        ipcMainApi.on('model-opened', handleModelOpened);
        ipcMainApi.on('model-print', handleModelPrint);
        ipcMainApi.on('model-save', handleModelSave);
        ipcMainApi.on('update-menu', handleUpdateMenu);

        registerLlmIpc();

        createWindow();

        // check for updates from github releases site
        autoUpdaterApi.checkForUpdatesAndNotify();
    });

    // this is emitted when a 'recent document' is opened
    app.on('open-file', function (event, filePath) {
        // apply custom handler to this event
        event.preventDefault();
        loggerApi.log.debug('Request to open file from recent documents: ' + filePath);
        menuApi.openModelRequest(filePath);
    });

    function handleCloseApp () {
        loggerApi.log.debug('Close application request from renderer ');
        runApp = false;
        app.quit();
    }

    function handleModelClosed (_event, fileName) {
        loggerApi.log.debug('Close model notification from renderer for file name: ' + fileName);
        menuApi.modelClosed();
    }

    function handleModelOpenConfirmed (_event, fileName) {
        loggerApi.log.debug('Open model confirmation from renderer for file name: ' + fileName);
        menuApi.openModel(fileName);
    }

    function handleModelOpened (_event, fileName) {
        loggerApi.log.debug('Open model notification from renderer for file name: ' + fileName);
        menuApi.modelOpened();
    }

    function handleModelPrint (_event, format) {
        loggerApi.log.debug('Model print request from renderer with printer : ' + format);
        menuApi.modelPrint(format);
    }

    function handleModelSave (_event, modelData, fileName) {
        loggerApi.log.debug('Model save request from renderer with file name : ' + fileName);
        menuApi.modelSave(modelData, fileName);
    }

    function handleUpdateMenu (_event, locale) {
        loggerApi.log.debug('Re-labeling the menu system for: ' + locale);
        menuApi.setLocale(locale);
        const template = menuApi.getMenuTemplate();
        MenuApi.setApplicationMenu(MenuApi.buildFromTemplate(template));
    }

    // Exit cleanly on request from parent process in development mode.
    if (isDev) {
        if (win) {
            process.on('message', (data) => {
                if (data === 'graceful-exit') {
                    app.quit();
                }
            });
        } else {
            process.on('SIGTERM', () => {
                app.quit();
            });
        }
    }
}

if (!isTest) {
    registerDesktop({
        app,
        protocol,
        BrowserWindow,
        Menu,
        ipcMain,
        menu,
        logger,
        utils: { electronURL, isDevelopment, isTest, isMacOS, isWin },
        createProtocol,
        installExtension,
        VUEJS_DEVTOOLS,
        autoUpdater,
        path
    });
}
