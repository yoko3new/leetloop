import type { Locale } from './i18n';

export type StudyPlanId = 'blind75' | 'neetcode250' | 'hot100';

export interface StudyPlanGroup {
  name: string;
  slugs: string[];
}

export interface StudyPlan {
  id: StudyPlanId;
  name: string;
  sourceUrl: string;
  groups: StudyPlanGroup[];
  slugs: string[];
}

// Snapshots of the public lists. Keeping them in the extension makes progress
// available offline and keeps denominators stable until we deliberately update
// a list. Sources: neetcode.io/practice/practice/{blind75,neetcode250} and
// leetcode.cn/studyplan/top-100-liked/ (September 2026).
const BLIND_75 = `
数组与哈希: contains-duplicate,valid-anagram,two-sum,group-anagrams,top-k-frequent-elements,encode-and-decode-strings,product-of-array-except-self,longest-consecutive-sequence
双指针: valid-palindrome,3sum,container-with-most-water
滑动窗口: best-time-to-buy-and-sell-stock,longest-substring-without-repeating-characters,longest-repeating-character-replacement,minimum-window-substring
栈: valid-parentheses
二分查找: find-minimum-in-rotated-sorted-array,search-in-rotated-sorted-array
链表: reverse-linked-list,merge-two-sorted-lists,linked-list-cycle,reorder-list,remove-nth-node-from-end-of-list,merge-k-sorted-lists
二叉树: invert-binary-tree,maximum-depth-of-binary-tree,same-tree,subtree-of-another-tree,lowest-common-ancestor-of-a-binary-search-tree,binary-tree-level-order-traversal,validate-binary-search-tree,kth-smallest-element-in-a-bst,construct-binary-tree-from-preorder-and-inorder-traversal,binary-tree-maximum-path-sum,serialize-and-deserialize-binary-tree
堆: find-median-from-data-stream
回溯: combination-sum,word-search
字典树: implement-trie-prefix-tree,design-add-and-search-words-data-structure,word-search-ii
图论: number-of-islands,clone-graph,pacific-atlantic-water-flow,course-schedule,graph-valid-tree,number-of-connected-components-in-an-undirected-graph
高级图论: alien-dictionary
一维动态规划: climbing-stairs,house-robber,house-robber-ii,longest-palindromic-substring,palindromic-substrings,decode-ways,coin-change,maximum-product-subarray,word-break,longest-increasing-subsequence
二维动态规划: unique-paths,longest-common-subsequence
贪心: maximum-subarray,jump-game
区间: insert-interval,merge-intervals,non-overlapping-intervals,meeting-rooms,meeting-rooms-ii
数学与几何: rotate-image,spiral-matrix,set-matrix-zeroes
位运算: number-of-1-bits,counting-bits,reverse-bits,missing-number,sum-of-two-integers
`;

const NEETCODE_250 = `
数组与哈希: concatenation-of-array,contains-duplicate,valid-anagram,two-sum,longest-common-prefix,group-anagrams,remove-element,majority-element,design-hashset,design-hashmap,sort-an-array,sort-colors,top-k-frequent-elements,encode-and-decode-strings,range-sum-query-2d-immutable,product-of-array-except-self,valid-sudoku,longest-consecutive-sequence,best-time-to-buy-and-sell-stock-ii,majority-element-ii,subarray-sum-equals-k,first-missing-positive
双指针: reverse-string,valid-palindrome,valid-palindrome-ii,merge-strings-alternately,merge-sorted-array,remove-duplicates-from-sorted-array,two-sum-ii-input-array-is-sorted,3sum,4sum,rotate-array,container-with-most-water,boats-to-save-people,trapping-rain-water
滑动窗口: contains-duplicate-ii,best-time-to-buy-and-sell-stock,longest-substring-without-repeating-characters,longest-repeating-character-replacement,permutation-in-string,minimum-size-subarray-sum,find-k-closest-elements,minimum-window-substring,sliding-window-maximum
栈: baseball-game,valid-parentheses,implement-stack-using-queues,implement-queue-using-stacks,min-stack,evaluate-reverse-polish-notation,asteroid-collision,daily-temperatures,online-stock-span,car-fleet,simplify-path,decode-string,maximum-frequency-stack,largest-rectangle-in-histogram
二分查找: binary-search,search-insert-position,guess-number-higher-or-lower,sqrtx,search-a-2d-matrix,koko-eating-bananas,capacity-to-ship-packages-within-d-days,find-minimum-in-rotated-sorted-array,search-in-rotated-sorted-array,search-in-rotated-sorted-array-ii,time-based-key-value-store,split-array-largest-sum,median-of-two-sorted-arrays,find-in-mountain-array
链表: reverse-linked-list,merge-two-sorted-lists,linked-list-cycle,reorder-list,remove-nth-node-from-end-of-list,copy-list-with-random-pointer,add-two-numbers,find-the-duplicate-number,reverse-linked-list-ii,design-circular-queue,lru-cache,lfu-cache,merge-k-sorted-lists,reverse-nodes-in-k-group
二叉树: binary-tree-inorder-traversal,binary-tree-preorder-traversal,binary-tree-postorder-traversal,invert-binary-tree,maximum-depth-of-binary-tree,diameter-of-binary-tree,balanced-binary-tree,same-tree,subtree-of-another-tree,lowest-common-ancestor-of-a-binary-search-tree,insert-into-a-binary-search-tree,delete-node-in-a-bst,binary-tree-level-order-traversal,binary-tree-right-side-view,construct-quad-tree,count-good-nodes-in-binary-tree,validate-binary-search-tree,kth-smallest-element-in-a-bst,construct-binary-tree-from-preorder-and-inorder-traversal,house-robber-iii,delete-leaves-with-a-given-value,binary-tree-maximum-path-sum,serialize-and-deserialize-binary-tree
堆: kth-largest-element-in-a-stream,last-stone-weight,k-closest-points-to-origin,kth-largest-element-in-an-array,task-scheduler,design-twitter,single-threaded-cpu,reorganize-string,longest-happy-string,car-pooling,find-median-from-data-stream,ipo
回溯: sum-of-all-subset-xor-totals,subsets,combination-sum,combination-sum-ii,combinations,permutations,subsets-ii,permutations-ii,generate-parentheses,word-search,palindrome-partitioning,letter-combinations-of-a-phone-number,matchsticks-to-square,partition-to-k-equal-sum-subsets,n-queens,n-queens-ii,word-break-ii
字典树: implement-trie-prefix-tree,design-add-and-search-words-data-structure,extra-characters-in-a-string,word-search-ii
图论: island-perimeter,verifying-an-alien-dictionary,find-the-town-judge,number-of-islands,max-area-of-island,clone-graph,walls-and-gates,rotting-oranges,pacific-atlantic-water-flow,surrounded-regions,open-the-lock,course-schedule,course-schedule-ii,graph-valid-tree,course-schedule-iv,number-of-connected-components-in-an-undirected-graph,redundant-connection,accounts-merge,evaluate-division,minimum-height-trees,word-ladder
高级图论: path-with-minimum-effort,network-delay-time,reconstruct-itinerary,min-cost-to-connect-all-points,swim-in-rising-water,alien-dictionary,cheapest-flights-within-k-stops,find-critical-and-pseudo-critical-edges-in-minimum-spanning-tree,build-a-matrix-with-conditions,greatest-common-divisor-traversal
一维动态规划: climbing-stairs,min-cost-climbing-stairs,n-th-tribonacci-number,house-robber,house-robber-ii,longest-palindromic-substring,palindromic-substrings,decode-ways,coin-change,maximum-product-subarray,word-break,longest-increasing-subsequence,partition-equal-subset-sum,combination-sum-iv,perfect-squares,integer-break,stone-game-iii
二维动态规划: unique-paths,unique-paths-ii,minimum-path-sum,longest-common-subsequence,last-stone-weight-ii,best-time-to-buy-and-sell-stock-with-cooldown,coin-change-ii,target-sum,interleaving-string,stone-game,stone-game-ii,longest-increasing-path-in-a-matrix,distinct-subsequences,edit-distance,burst-balloons,regular-expression-matching
贪心: lemonade-change,maximum-subarray,maximum-sum-circular-subarray,longest-turbulent-subarray,jump-game,jump-game-ii,jump-game-vii,gas-station,hand-of-straights,dota2-senate,merge-triplets-to-form-target-triplet,partition-labels,valid-parenthesis-string,candy
区间: insert-interval,merge-intervals,non-overlapping-intervals,meeting-rooms,meeting-rooms-ii,meeting-rooms-iii,minimum-interval-to-include-each-query
数学与几何: excel-sheet-column-title,greatest-common-divisor-of-strings,insert-greatest-common-divisors-in-linked-list,transpose-matrix,rotate-image,spiral-matrix,set-matrix-zeroes,happy-number,plus-one,roman-to-integer,powx-n,multiply-strings,detect-squares
位运算: single-number,number-of-1-bits,counting-bits,add-binary,reverse-bits,missing-number,sum-of-two-integers,reverse-integer,bitwise-and-of-numbers-range,minimum-array-end
`;

const HOT_100 = `
哈希: two-sum,group-anagrams,longest-consecutive-sequence
双指针: move-zeroes,container-with-most-water,3sum,trapping-rain-water
滑动窗口: longest-substring-without-repeating-characters,find-all-anagrams-in-a-string
子串: subarray-sum-equals-k,sliding-window-maximum,minimum-window-substring
普通数组: maximum-subarray,merge-intervals,rotate-array,product-of-array-except-self,first-missing-positive
矩阵: set-matrix-zeroes,spiral-matrix,rotate-image,search-a-2d-matrix-ii
链表: intersection-of-two-linked-lists,reverse-linked-list,palindrome-linked-list,linked-list-cycle,linked-list-cycle-ii,merge-two-sorted-lists,add-two-numbers,remove-nth-node-from-end-of-list,swap-nodes-in-pairs,reverse-nodes-in-k-group,copy-list-with-random-pointer,sort-list,merge-k-sorted-lists,lru-cache
二叉树: binary-tree-inorder-traversal,maximum-depth-of-binary-tree,invert-binary-tree,symmetric-tree,diameter-of-binary-tree,binary-tree-level-order-traversal,convert-sorted-array-to-binary-search-tree,validate-binary-search-tree,kth-smallest-element-in-a-bst,binary-tree-right-side-view,flatten-binary-tree-to-linked-list,construct-binary-tree-from-preorder-and-inorder-traversal,path-sum-iii,lowest-common-ancestor-of-a-binary-tree,binary-tree-maximum-path-sum
图论: number-of-islands,rotting-oranges,course-schedule,implement-trie-prefix-tree
回溯: permutations,subsets,letter-combinations-of-a-phone-number,combination-sum,generate-parentheses,word-search,palindrome-partitioning,n-queens
二分查找: search-insert-position,search-a-2d-matrix,find-first-and-last-position-of-element-in-sorted-array,search-in-rotated-sorted-array,find-minimum-in-rotated-sorted-array,median-of-two-sorted-arrays
栈: valid-parentheses,min-stack,decode-string,daily-temperatures,largest-rectangle-in-histogram
堆: kth-largest-element-in-an-array,top-k-frequent-elements,find-median-from-data-stream
贪心算法: best-time-to-buy-and-sell-stock,jump-game,jump-game-ii,partition-labels
动态规划: climbing-stairs,pascals-triangle,house-robber,perfect-squares,coin-change,word-break,longest-increasing-subsequence,maximum-product-subarray,partition-equal-subset-sum,longest-valid-parentheses
多维动态规划: unique-paths,minimum-path-sum,longest-palindromic-substring,longest-common-subsequence,edit-distance
技巧: single-number,majority-element,sort-colors,next-permutation,find-the-duplicate-number
`;

function makePlan(
  id: StudyPlanId,
  name: string,
  sourceUrl: string,
  raw: string,
  expectedCount: number,
): StudyPlan {
  const groups = raw.trim().split('\n').map((line) => {
    const separator = line.indexOf(':');
    return {
      name: line.slice(0, separator).trim(),
      slugs: line.slice(separator + 1).split(',').map((slug) => slug.trim()),
    };
  });
  const slugs = groups.flatMap((group) => group.slugs);
  if (slugs.length !== expectedCount || new Set(slugs).size !== expectedCount) {
    throw new Error(`${name} 题单数据有重复或缺失`);
  }
  return { id, name, sourceUrl, groups, slugs };
}

export const STUDY_PLANS: StudyPlan[] = [
  makePlan('blind75', 'Blind 75', 'https://neetcode.io/practice/practice/blind75', BLIND_75, 75),
  makePlan('neetcode250', 'NeetCode 250', 'https://neetcode.io/practice/practice/neetcode250', NEETCODE_250, 250),
  makePlan('hot100', '热题 100', 'https://leetcode.cn/studyplan/top-100-liked/', HOT_100, 100),
];

export function getStudyPlan(id: StudyPlanId): StudyPlan {
  return STUDY_PLANS.find((plan) => plan.id === id) ?? STUDY_PLANS[0]!;
}

const ENGLISH_GROUP_NAMES: Record<string, string> = {
  '数组与哈希': 'Arrays & Hashing',
  '双指针': 'Two Pointers',
  '滑动窗口': 'Sliding Window',
  '栈': 'Stack',
  '二分查找': 'Binary Search',
  '链表': 'Linked List',
  '二叉树': 'Binary Tree',
  '堆': 'Heap',
  '回溯': 'Backtracking',
  '字典树': 'Tries',
  '图论': 'Graphs',
  '高级图论': 'Advanced Graphs',
  '一维动态规划': '1-D Dynamic Programming',
  '二维动态规划': '2-D Dynamic Programming',
  '贪心': 'Greedy',
  '区间': 'Intervals',
  '数学与几何': 'Math & Geometry',
  '位运算': 'Bit Manipulation',
  '哈希': 'Hashing',
  '子串': 'Substrings',
  '普通数组': 'Arrays',
  '矩阵': 'Matrix',
  '贪心算法': 'Greedy',
  '动态规划': 'Dynamic Programming',
  '多维动态规划': 'Multidimensional DP',
  '技巧': 'Techniques',
};

export function studyPlanName(plan: StudyPlan, locale: Locale): string {
  return locale === 'en' && plan.id === 'hot100' ? 'LeetCode Top 100' : plan.name;
}

export function studyPlanGroupName(name: string, locale: Locale): string {
  return locale === 'en' ? ENGLISH_GROUP_NAMES[name] ?? name : name;
}

export function titleFromSlug(slug: string): string {
  const special: Record<string, string> = {
    '3sum': '3Sum',
    '4sum': '4Sum',
    'sqrtx': 'Sqrt(x)',
    'powx-n': 'Pow(x, n)',
    'lru-cache': 'LRU Cache',
    'lfu-cache': 'LFU Cache',
    'n-queens': 'N-Queens',
    'n-queens-ii': 'N-Queens II',
  };
  return special[slug] ?? slug.split('-').map((word) =>
    word.length <= 2 && /^(ii|iii|iv|k)$/.test(word)
      ? word.toUpperCase()
      : word.charAt(0).toUpperCase() + word.slice(1),
  ).join(' ');
}
