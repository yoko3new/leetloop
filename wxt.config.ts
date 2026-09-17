import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'LeetLoop',
    description: '自动记录 LeetCode 提交，并在遗忘前安排复习。',
    version: '0.2.0',
    minimum_chrome_version: '116',
    permissions: ['alarms', 'notifications', 'sidePanel'],
    action: {
      default_title: '打开 LeetLoop',
    },
    icons: {
      16: '/icons/icon-16.png',
      32: '/icons/icon-32.png',
      48: '/icons/icon-48.png',
      128: '/icons/icon-128.png',
    },
  },
});
