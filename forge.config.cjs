const path = require('node:path');
const stagingBuild = process.env.KOKO_BUILD_CHANNEL === 'staging';
const appIdentifier = stagingBuild ? 'KOKOPhotoboothStaging' : 'KOKOPhotobooth';
const executableName = stagingBuild ? 'KOKOStudioStaging' : 'KOKOPhotobooth';
const appName = stagingBuild ? 'KOKO Studio Staging' : 'KOKO Studio';

module.exports = {
  outDir: process.env.KOKO_FORGE_OUT_DIR || 'out',
  packagerConfig: {
    name: appName,
    asar: true,
    executableName,
    appBundleId: stagingBuild ? 'com.koko.studio.staging' : 'com.koko.studio',
    icon: path.join(__dirname, 'assets', 'koko-studio'),
    extendInfo: {
      NSCameraUsageDescription: 'KOKO Studio uses the camera to preview and capture event photos.',
      NSMicrophoneUsageDescription: 'KOKO Studio uses the microphone when recording event videos.'
    }
  },
  makers: [
    { name: '@electron-forge/maker-squirrel', platforms: ['win32'], config: { name: appIdentifier, setupIcon: path.join(__dirname, 'assets', 'koko-studio.ico') } },
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] }
  ],
  plugins: [{
    name: '@electron-forge/plugin-vite',
    config: {
      hotRestart: true,
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.mjs' },
        { entry: 'src/preload/index.ts', config: 'vite.preload.config.mjs' }
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.mjs' }]
    }
  }]
};
