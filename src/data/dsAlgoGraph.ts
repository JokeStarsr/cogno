import type { ConceptNode } from '../types'

/**
 * 首个垂直知识领域：数据结构与算法
 * 概念依赖关系清晰，适合验证知识图谱与缺口导航。
 */
export const DOMAINS = [
  '复杂度与基础',
  '线性结构',
  '树',
  '图论',
  '搜索与递归',
  '排序',
  '动态规划',
  '贪心与技巧',
  '字符串',
  '数论',
] as const

export const DS_ALGO_GRAPH: ConceptNode[] = [
  // ── 复杂度与基础 ──
  { id: 'complexity', label: '时间复杂度', domain: '复杂度与基础', description: '用 O 记号度量算法运行时间随输入规模的增长趋势。', dependencies: [], difficulty: 1 },
  { id: 'space-complexity', label: '空间复杂度', domain: '复杂度与基础', description: '度量算法运行时额外占用的内存空间规模。', dependencies: ['complexity'], difficulty: 1 },
  { id: 'big-o-notation', label: '大O记号', domain: '复杂度与基础', description: '渐进上界记号，忽略常数与低阶项，刻画最坏情况增长。', dependencies: ['complexity'], difficulty: 1 },

  // ── 线性结构 ──
  { id: 'array', label: '数组', domain: '线性结构', description: '连续内存存储的同质元素序列，随机访问 O(1)，插入删除 O(n)。', dependencies: [], difficulty: 1 },
  { id: 'linked-list', label: '链表', domain: '线性结构', description: '节点指针串联的线性结构，插入删除 O(1)，随机访问 O(n)。', dependencies: [], difficulty: 1 },
  { id: 'fast-slow-pointer', label: '链表快慢指针', domain: '线性结构', description: '一个步长1一个步长2的指针技巧，用于找中点、判环。', dependencies: ['linked-list'], difficulty: 2 },
  { id: 'cycle-detection', label: '链表环检测', domain: '线性结构', description: '快慢指针相遇即存在环，用于 Floyd 判圈法。', dependencies: ['fast-slow-pointer'], difficulty: 2 },
  { id: 'stack', label: '栈', domain: '线性结构', description: '后进先出（LIFO）的线性结构，入栈出栈 O(1)。', dependencies: ['array'], difficulty: 1 },
  { id: 'expression-eval', label: '栈的应用·表达式求值', domain: '线性结构', description: '用栈处理运算符优先级，中缀转后缀再求值。', dependencies: ['stack'], difficulty: 2 },
  { id: 'monotonic-stack', label: '单调栈', domain: '线性结构', description: '维护栈内元素单调，用于找左右两侧第一个更大/更小元素。', dependencies: ['stack'], difficulty: 2 },
  { id: 'queue', label: '队列', domain: '线性结构', description: '先进先出（FIFO）的线性结构，入队出队 O(1)。', dependencies: ['array'], difficulty: 1 },
  { id: 'monotonic-queue', label: '单调队列', domain: '线性结构', description: '维护队列内元素单调，配合滑动窗口求窗口最值。', dependencies: ['queue'], difficulty: 2 },
  { id: 'sliding-window', label: '滑动窗口', domain: '线性结构', description: '双指针维护可变长度窗口，用于子数组/子串问题。', dependencies: ['queue', 'two-pointers'], difficulty: 2 },
  { id: 'two-pointers', label: '双指针', domain: '线性结构', description: '左右指针相向或同向移动，常将 O(n²) 优化为 O(n)。', dependencies: ['array'], difficulty: 2 },
  { id: 'prefix-sum', label: '前缀和', domain: '线性结构', description: '预处理前缀和数组，O(1) 求任意区间和。', dependencies: ['array'], difficulty: 1 },
  { id: 'hash-table', label: '哈希表', domain: '线性结构', description: '键值映射，平均 O(1) 插入查询，以空间换时间。', dependencies: [], difficulty: 1 },
  { id: 'hash-collision', label: '哈希冲突解决', domain: '线性结构', description: '开放寻址或链地址法处理不同键落到同桶的情况。', dependencies: ['hash-table'], difficulty: 2 },
  { id: 'set-map', label: '集合与映射', domain: '线性结构', description: '基于哈希或平衡树的抽象数据类型，去重与关联。', dependencies: ['hash-table'], difficulty: 1 },

  // ── 树 ──
  { id: 'binary-tree', label: '二叉树', domain: '树', description: '每个节点最多两个孩子的树结构。', dependencies: ['linked-list', 'recursion'], difficulty: 1 },
  { id: 'tree-traversal', label: '树的遍历', domain: '树', description: '前序/中序/后序/层序，递归与迭代两种实现。', dependencies: ['binary-tree', 'stack', 'queue'], difficulty: 1 },
  { id: 'bst', label: '二叉搜索树', domain: '树', description: '左小右大的有序二叉树，查找插入 O(log n) 均摊。', dependencies: ['binary-tree', 'tree-traversal'], difficulty: 2 },
  { id: 'heap', label: '堆', domain: '树', description: '完全二叉树实现的优先队列，取最值 O(1)、入堆 O(log n)。', dependencies: ['binary-tree', 'array'], difficulty: 2 },
  { id: 'avl', label: '平衡二叉树', domain: '树', description: '通过旋转维持左右子树高度差，保证 O(log n) 操作。', dependencies: ['bst'], difficulty: 3 },
  { id: 'trie', label: '前缀树 Trie', domain: '树', description: '按字符前缀组织的树，用于字符串集合与自动补全。', dependencies: ['tree-traversal'], difficulty: 2 },
  { id: 'fenwick', label: '树状数组', domain: '树', description: '用 lowbit 实现的前缀信息维护结构，单点改区间查 O(log n)。', dependencies: ['binary-tree', 'prefix-sum'], difficulty: 3 },
  { id: 'segment-tree', label: '线段树', domain: '树', description: '分治思想的区间树，支持区间修改与区间查询。', dependencies: ['binary-tree', 'divide-conquer'], difficulty: 3 },

  // ── 搜索与递归 ──
  { id: 'recursion', label: '递归', domain: '搜索与递归', description: '函数调用自身，把问题拆为更小的同类子问题。', dependencies: ['stack'], difficulty: 1 },
  { id: 'divide-conquer', label: '分治', domain: '搜索与递归', description: '拆分子问题、递归求解、合并结果，如归并排序。', dependencies: ['recursion', 'complexity'], difficulty: 2 },
  { id: 'binary-search', label: '二分查找', domain: '搜索与递归', description: '在有序序列上每次排除一半，O(log n) 定位目标。', dependencies: ['array', 'big-o-notation'], difficulty: 2 },
  { id: 'backtracking', label: '回溯算法', domain: '搜索与递归', description: '系统化搜索解空间，不满足条件即剪枝回溯。', dependencies: ['recursion'], difficulty: 2 },
  { id: 'memoization', label: '记忆化搜索', domain: '搜索与递归', description: '缓存递归子问题结果，避免重复计算。', dependencies: ['recursion'], difficulty: 2 },

  // ── 排序 ──
  { id: 'bubble-sort', label: '冒泡排序', domain: '排序', description: '相邻元素反复交换的 O(n²) 稳定排序，教学意义。', dependencies: ['array', 'big-o-notation'], difficulty: 1 },
  { id: 'insertion-sort', label: '插入排序', domain: '排序', description: '把元素逐个插入已排序部分，近乎有序时接近 O(n)。', dependencies: ['array'], difficulty: 1 },
  { id: 'merge-sort', label: '归并排序', domain: '排序', description: '分治思想的稳定排序，O(n log n)，需额外空间。', dependencies: ['divide-conquer'], difficulty: 2 },
  { id: 'quick-sort', label: '快速排序', domain: '排序', description: '选基准划分的原地排序，期望 O(n log n)，不稳定。', dependencies: ['divide-conquer', 'two-pointers'], difficulty: 2 },
  { id: 'heap-sort', label: '堆排序', domain: '排序', description: '建堆后反复取堆顶，O(n log n) 原地不稳定排序。', dependencies: ['heap'], difficulty: 2 },
  { id: 'topological-sort', label: '拓扑排序', domain: '排序', description: '有向无环图的线性排序，每次取入度为零的节点。', dependencies: ['graph', 'queue'], difficulty: 2 },

  // ── 图论 ──
  { id: 'graph', label: '图', domain: '图论', description: '顶点与边组成的结构，有向/无向、有权/无权。', dependencies: ['hash-table', 'linked-list'], difficulty: 1 },
  { id: 'dfs', label: '深度优先搜索', domain: '图论', description: '沿一条分支走到黑再回退的搜索，用栈或递归。', dependencies: ['graph', 'recursion'], difficulty: 2 },
  { id: 'bfs', label: '广度优先搜索', domain: '图论', description: '按层扩展的搜索，用队列，天然求无权最短路。', dependencies: ['graph', 'queue'], difficulty: 2 },
  { id: 'union-find', label: '并查集', domain: '图论', description: '近乎 O(1) 的连通性判断与合并，路径压缩+按秩合并。', dependencies: ['array'], difficulty: 2 },
  { id: 'dijkstra', label: 'Dijkstra 最短路径', domain: '图论', description: '非负权单源最短路，贪心扩展+优先队列。', dependencies: ['graph', 'heap', 'bfs'], difficulty: 3 },
  { id: 'bellman-ford', label: 'Bellman-Ford 算法', domain: '图论', description: '处理含负权边的最短路，可检测负环。', dependencies: ['graph', 'complexity'], difficulty: 3 },
  { id: 'mst', label: '最小生成树', domain: '图论', description: '连接所有顶点且权重和最小的树，Kruskal/Prim。', dependencies: ['graph', 'union-find'], difficulty: 3 },

  // ── 动态规划 ──
  { id: 'dp-basics', label: '动态规划基础', domain: '动态规划', description: '最优子结构+重叠子问题，用状态与转移描述问题。', dependencies: ['recursion', 'memoization'], difficulty: 2 },
  { id: 'knapsack', label: '背包问题', domain: '动态规划', description: '0-1背包、完全背包、多重背包的状态定义与优化。', dependencies: ['dp-basics', 'array'], difficulty: 2 },
  { id: 'lcs', label: '最长公共子序列', domain: '动态规划', description: '两个序列的最长公共子序列，二维状态经典题。', dependencies: ['dp-basics', 'string-basics'], difficulty: 2 },
  { id: 'lis', label: '最长递增子序列', domain: '动态规划', description: '序列的最长递增子序列，可二分优化到 O(n log n)。', dependencies: ['dp-basics', 'binary-search'], difficulty: 3 },
  { id: 'interval-dp', label: '区间DP', domain: '动态规划', description: '状态为区间的动态规划，常见于合并类问题。', dependencies: ['dp-basics'], difficulty: 3 },
  { id: 'digit-dp', label: '数位DP', domain: '动态规划', description: '按位枚举计数，处理"小于等于 N 的合法数"类问题。', dependencies: ['dp-basics', 'number-theory'], difficulty: 3 },

  // ── 贪心与技巧 ──
  { id: 'greedy', label: '贪心算法', domain: '贪心与技巧', description: '每步选当前最优解，需证明局部最优即全局最优。', dependencies: ['array', 'big-o-notation'], difficulty: 2 },
  { id: 'bit-manipulation', label: '位运算', domain: '贪心与技巧', description: '与或异或移位等运算，用于状态压缩与技巧优化。', dependencies: ['number-theory'], difficulty: 2 },

  // ── 字符串 ──
  { id: 'string-basics', label: '字符串基础', domain: '字符串', description: '字符序列的基本操作与遍历，注意子串与子序列区别。', dependencies: ['array'], difficulty: 1 },
  { id: 'kmp', label: 'KMP 字符串匹配', domain: '字符串', description: '借助 next 数组避免回溯的 O(n+m) 模式匹配。', dependencies: ['string-basics'], difficulty: 3 },
  { id: 'manacher', label: 'Manacher 回文', domain: '字符串', description: '利用对称性 O(n) 求所有回文子串的算法。', dependencies: ['string-basics'], difficulty: 3 },

  // ── 数论 ──
  { id: 'number-theory', label: '数论基础', domain: '数论', description: '整除、同余、欧几里得算法等整数性质。', dependencies: ['complexity'], difficulty: 1 },
  { id: 'sieve', label: '素数筛法', domain: '数论', description: '埃氏筛/欧拉筛在 O(n log log n) 或 O(n) 内筛出素数。', dependencies: ['number-theory', 'array'], difficulty: 2 },
  { id: 'fastpow', label: '快速幂', domain: '数论', description: '二进制分解指数，O(log n) 求 a^n 取模。', dependencies: ['number-theory'], difficulty: 2 },
  { id: 'matrix-fastpow', label: '矩阵快速幂', domain: '数论', description: '把递推式化为矩阵乘法，加速线性递推。', dependencies: ['fastpow'], difficulty: 3 },
]

export function getConcept(id: string): ConceptNode | undefined {
  return DS_ALGO_GRAPH.find((c) => c.id === id)
}

export const nodeById = new Map(DS_ALGO_GRAPH.map((n) => [n.id, n]))
