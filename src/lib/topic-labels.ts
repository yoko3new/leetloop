const TOPIC_LABELS: Record<string, string> = {
  array: '数组',
  'hash-table': '哈希表',
  string: '字符串',
  'dynamic-programming': '动态规划',
  math: '数学',
  sorting: '排序',
  greedy: '贪心',
  'depth-first-search': '深度优先搜索',
  'binary-search': '二分查找',
  database: '数据库',
  matrix: '矩阵',
  tree: '树',
  'breadth-first-search': '广度优先搜索',
  'bit-manipulation': '位运算',
  'two-pointers': '双指针',
  'prefix-sum': '前缀和',
  heap: '堆',
  'priority-queue': '优先队列',
  simulation: '模拟',
  'binary-tree': '二叉树',
  stack: '栈',
  graph: '图',
  counting: '计数',
  'sliding-window': '滑动窗口',
  design: '设计',
  enumeration: '枚举',
  'backtracking': '回溯',
  'union-find': '并查集',
  'linked-list': '链表',
  'ordered-set': '有序集合',
  'monotonic-stack': '单调栈',
  trie: '字典树',
  recursion: '递归',
  'divide-and-conquer': '分治',
  queue: '队列',
  memoization: '记忆化搜索',
  geometry: '几何',
  'binary-indexed-tree': '树状数组',
  'segment-tree': '线段树',
  'topological-sort': '拓扑排序',
  'shortest-path': '最短路',
};

export function normalizeTopic(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function topicLabel(topic: string, locale: Locale = 'zh'): string {
  const key = normalizeTopic(topic);
  if (locale === 'en') {
    return key.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || topic;
  }
  return TOPIC_LABELS[key] ?? topic;
}
import type { Locale } from './i18n';
