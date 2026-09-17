import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'LeetLoop',
    description: 'Track LeetCode submissions and schedule spaced reviews before you forget.',
    version: '0.3.0',
    minimum_chrome_version: '116',
    permissions: ['alarms', 'notifications', 'sidePanel'],
    action: {
      default_title: 'Open LeetLoop',
    },
    icons: {
      16: '/icons/icon-16.png',
      32: '/icons/icon-32.png',
      48: '/icons/icon-48.png',
      128: '/icons/icon-128.png',
    },
  },
});
