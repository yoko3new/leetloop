import type {
  AttemptCapture,
  ExtensionRequest,
  ExtensionResponse,
  HintExposure,
  ProblemCapture,
  ProblemDifficulty,
  ProblemStatus,
  RecordAttemptResponse,
  SubmissionVerdict,
} from '../../lib/types';
import { terminalBelongsToAttempt } from '../../lib/capture-state';
import { getLocale, t, type Locale, type TextKey } from '../../lib/i18n';

const PROBLEM_PATH = /^\/problems\/([^/]+)/;
const RESULT_SELECTOR = [
  '[data-e2e-locator="submission-result"]',
  '[data-e2e-locator*="submission-result"]',
  '[data-cy="submission-result"]',
  '[data-cy*="submission-result"]',
  '[class*="submission-result" i]',
].join(',');
const SUBMIT_SELECTOR = [
  '[data-e2e-locator="console-submit-button"]',
  '[data-cy="submit-code-btn"]',
  'button[aria-label="Submit"]',
  'button[aria-label="提交"]',
].join(',');
const WAITING_RESULT = /\b(?:judging|pending|running|submitting)\b|判题中|等待中|提交中/i;
const UI_HOST_ID = 'leetloop-page-ui';

const VERDICTS: ReadonlyArray<readonly [RegExp, SubmissionVerdict]> = [
  [/\bAccepted\b|通过|答案正确/i, 'Accepted'],
  [/\bWrong Answer\b|答案错误/i, 'Wrong Answer'],
  [/\bTime Limit Exceeded\b|超出时间限制/i, 'Time Limit Exceeded'],
  [/\bRuntime Error\b|执行出错|运行时错误/i, 'Runtime Error'],
  [/\bMemory Limit Exceeded\b|超出内存限制/i, 'Memory Limit Exceeded'],
  [/\bCompile Error\b|编译出错|编译错误/i, 'Compile Error'],
  [/\bOutput Limit Exceeded\b|超出输出限制/i, 'Output Limit Exceeded'],
];
const EXACT_VERDICTS: ReadonlyArray<readonly [RegExp, SubmissionVerdict]> = [
  [/^(?:Accepted|通过|答案正确)$/i, 'Accepted'],
  [/^(?:Wrong Answer|答案错误)$/i, 'Wrong Answer'],
  [/^(?:Time Limit Exceeded|超出时间限制)$/i, 'Time Limit Exceeded'],
  [/^(?:Runtime Error|执行出错|运行时错误)$/i, 'Runtime Error'],
  [/^(?:Memory Limit Exceeded|超出内存限制)$/i, 'Memory Limit Exceeded'],
  [/^(?:Compile Error|编译出错|编译错误)$/i, 'Compile Error'],
  [/^(?:Output Limit Exceeded|超出输出限制)$/i, 'Output Limit Exceeded'],
];

const VERDICT_KEYS: Record<SubmissionVerdict, TextKey> = {
  Accepted: 'verdictAccepted',
  'Wrong Answer': 'verdictWrong',
  'Time Limit Exceeded': 'verdictTime',
  'Runtime Error': 'verdictRuntime',
  'Memory Limit Exceeded': 'verdictMemory',
  'Compile Error': 'verdictCompile',
  'Output Limit Exceeded': 'verdictOutput',
  Unknown: 'verdictUnknown',
};

interface PendingAttempt {
  id: string;
  problem: ProblemCapture;
  clickedAt: number;
  submittedAt: string;
  elapsedMs: number;
  attemptNumber: number;
  hintExposure: HintExposure;
  language?: string;
  baselineVerdict?: SubmissionVerdict;
  sawTransition: boolean;
}

function compactText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function routeSlug(): string | undefined {
  const match = location.pathname.match(PROBLEM_PATH);
  if (!match?.[1]) return undefined;

  try {
    const slug = decodeURIComponent(match[1]);
    return /^[a-z0-9-]+$/i.test(slug) ? slug : undefined;
  } catch {
    return undefined;
  }
}

function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function cleanTitle(raw: string): string {
  return compactText(raw)
    .replace(/\s*[-|]\s*LeetCode.*$/i, '')
    .replace(/^\d+\s*[.)．、]\s*/, '')
    .trim();
}

function elementForNode(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

function isVisible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;

  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  return element.getClientRects().length > 0;
}

function readTitle(slug: string): string {
  const semanticSelectors = [
    '[data-cy="question-title"]',
    '[data-e2e-locator="problem-title"]',
    '[data-e2e-locator="question-title"]',
  ];

  for (const selector of semanticSelectors) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      const title = cleanTitle(element.textContent ?? '');
      if (isVisible(element) && title.length >= 2 && title.length <= 160) return title;
    }
  }

  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    try {
      const url = new URL(anchor.href, location.href);
      if (url.pathname.replace(/\/+$/, '') !== `/problems/${slug}`) continue;
      const title = cleanTitle(anchor.textContent ?? '');
      if (title.length >= 2 && title.length <= 160) return title;
    } catch {
      // Ignore malformed links inserted by page scripts.
    }
  }

  const heading = document.querySelector<HTMLElement>('main h1');
  if (isVisible(heading)) {
    const title = cleanTitle(heading.textContent ?? '');
    if (title.length >= 2 && title.length <= 160) return title;
  }

  return cleanTitle(document.title) || humanizeSlug(slug);
}

function difficultyFromText(raw: string): ProblemDifficulty | undefined {
  const text = compactText(raw);
  if (/\bEasy\b|简单/i.test(text)) return 'Easy';
  if (/\bMedium\b|中等/i.test(text)) return 'Medium';
  if (/\bHard\b|困难/i.test(text)) return 'Hard';
  return undefined;
}

function readDifficulty(): ProblemDifficulty {
  const semanticElements = document.querySelectorAll<HTMLElement>(
    '[data-difficulty], [class*="difficulty" i], [data-e2e-locator*="difficulty" i]',
  );

  for (const element of semanticElements) {
    if (!isVisible(element)) continue;
    const semanticDifficulty = difficultyFromText(
      `${element.dataset.difficulty ?? ''} ${element.className}`,
    );
    if (semanticDifficulty) return semanticDifficulty;

    const label = compactText(element.textContent);
    if (/^(Easy|Medium|Hard|简单|中等|困难)$/i.test(label)) {
      const labelDifficulty = difficultyFromText(label);
      if (labelDifficulty) return labelDifficulty;
    }
  }

  // Older layouts use generated class names, so exact visible labels are the final fallback.
  for (const element of document.querySelectorAll<HTMLElement>('main span, main div, span, div')) {
    if (!isVisible(element)) continue;
    const label = compactText(element.textContent);
    if (!/^(Easy|Medium|Hard|简单|中等|困难)$/i.test(label)) continue;
    const difficulty = difficultyFromText(label);
    if (difficulty) return difficulty;
  }

  return 'Unknown';
}

function normalizeTopic(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function readTopics(): string[] {
  const topics = new Set<string>();

  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href*="/tag/"]')) {
    try {
      const url = new URL(anchor.href, location.href);
      const match = url.pathname.match(/\/tag\/([^/]+)/);
      const topic = normalizeTopic(match?.[1] ?? anchor.textContent ?? '');
      if (topic) topics.add(topic);
    } catch {
      // Ignore malformed links inserted by page scripts.
    }

    if (topics.size >= 24) break;
  }

  return [...topics];
}

function captureProblem(slug: string): ProblemCapture {
  return {
    slug,
    title: readTitle(slug),
    url: `https://leetcode.com/problems/${slug}/`,
    difficulty: readDifficulty(),
    topics: readTopics(),
  };
}

function verdictFromText(raw: string | null | undefined): SubmissionVerdict | undefined {
  if (!raw) return undefined;
  const text = compactText(raw);
  if (!text || text.length > 800) return undefined;

  for (const [pattern, verdict] of VERDICTS) {
    if (pattern.test(text)) return verdict;
  }

  return undefined;
}

function exactVerdictFromText(raw: string | null | undefined): SubmissionVerdict | undefined {
  const text = compactText(raw);

  for (const [pattern, verdict] of EXACT_VERDICTS) {
    if (pattern.test(text)) return verdict;
  }

  return undefined;
}

function currentVisibleVerdict(): SubmissionVerdict | undefined {
  for (const element of document.querySelectorAll<HTMLElement>(RESULT_SELECTOR)) {
    if (!isVisible(element)) continue;
    const verdict = verdictFromText(element.textContent);
    if (verdict) return verdict;
  }
  return undefined;
}

function readLanguage(): string | undefined {
  const selectors = [
    '[data-e2e-locator="console-language-button"]',
    '[data-e2e-locator*="language" i]',
    '[data-cy="lang-select"]',
    '[aria-label*="language" i]',
  ];
  const knownLanguage = /^(?:C|C\+\+|C#|Java|Python|Python3|JavaScript|TypeScript|PHP|Swift|Kotlin|Dart|Go|Golang|Ruby|Scala|Rust|Racket|Erlang|Elixir|MySQL|MS SQL Server|Oracle|PostgreSQL|Pandas|Bash)$/i;

  for (const selector of selectors) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      const language = compactText(element.textContent ?? element.getAttribute('aria-label'));
      if (isVisible(element) && language && language.length <= 40) return language;
    }
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('button')) {
    const language = compactText(button.textContent);
    if (isVisible(button) && knownLanguage.test(language)) return language;
  }

  return undefined;
}

function uniqueEventId(slug: string, timestamp: number): string {
  const randomPart =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `leetcode:${slug}:${timestamp}:${randomPart}`;
}

function isProblemStatus(value: unknown): value is ProblemStatus {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tracked' in value &&
    typeof (value as { tracked?: unknown }).tracked === 'boolean' &&
    'due' in value &&
    typeof (value as { due?: unknown }).due === 'boolean'
  );
}

function isRecordAttemptResponse(value: unknown): value is RecordAttemptResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'duplicate' in value &&
    typeof (value as { duplicate?: unknown }).duplicate === 'boolean' &&
    'accepted' in value &&
    typeof (value as { accepted?: unknown }).accepted === 'boolean'
  );
}

export default defineContentScript({
  matches: ['https://leetcode.com/problems/*'],
  runAt: 'document_idle',

  main() {
    let currentSlug: string | undefined;
    let routeGeneration = 0;
    let pageStartedAt = Date.now();
    let pageSeenAt = new Date(pageStartedAt).toISOString();
    let pageSeenSent = false;
    let attemptNumber = 0;
    let hintExposure: HintExposure = 'none';
    let pendingAttempt: PendingAttempt | undefined;
    let hydrateTimer: number | undefined;
    let navigationTimer: number | undefined;
    let lastSubmitClickAt = 0;
    let uiRoot: ShadowRoot | undefined;
    let locale: Locale = 'en';
    let currentStatus: ProblemStatus | undefined;

    function dateLanguage(): string {
      return locale === 'zh' ? 'zh-CN' : 'en-US';
    }

    function mountUi(): ShadowRoot {
      if (uiRoot) return uiRoot;

      document.getElementById(UI_HOST_ID)?.remove();
      const host = document.createElement('div');
      host.id = UI_HOST_ID;
      host.setAttribute('data-leetloop-owned', 'true');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          #due-pill {
            align-items: center;
            background: rgba(5, 150, 105, .96);
            border: 1px solid rgba(255, 255, 255, .24);
            border-radius: 999px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, .18);
            color: #fff;
            display: none;
            font: 600 12px/1.2 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            gap: 6px;
            letter-spacing: .01em;
            padding: 8px 11px;
            pointer-events: none;
            position: fixed;
            right: 18px;
            top: 72px;
            z-index: 2147483647;
          }
          #due-pill.visible { display: flex; }
          #due-dot {
            background: #d1fae5;
            border-radius: 50%;
            box-shadow: 0 0 0 3px rgba(209, 250, 229, .18);
            height: 6px;
            width: 6px;
          }
          #toasts {
            align-items: flex-end;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
            position: fixed;
            right: 18px;
            top: 112px;
            z-index: 2147483647;
          }
          .toast {
            animation: ll-in .18s ease-out;
            background: rgba(24, 24, 27, .94);
            border: 1px solid rgba(255, 255, 255, .12);
            border-radius: 10px;
            box-shadow: 0 10px 28px rgba(0, 0, 0, .2);
            color: #f4f4f5;
            font: 500 13px/1.35 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            max-width: 310px;
            padding: 10px 12px;
          }
          .toast[data-tone="success"] { border-color: rgba(52, 211, 153, .55); }
          .toast[data-tone="error"] { border-color: rgba(248, 113, 113, .55); }
          .toast.leaving { animation: ll-out .18s ease-in forwards; }
          @keyframes ll-in {
            from { opacity: 0; transform: translateY(-4px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes ll-out {
            from { opacity: 1; transform: translateY(0); }
            to { opacity: 0; transform: translateY(-4px); }
          }
          @media (prefers-reduced-motion: reduce) {
            .toast, .toast.leaving { animation: none; }
          }
        </style>
        <div id="due-pill" role="status" aria-live="polite">
          <span id="due-dot"></span>
          <span id="due-text">${t(locale, 'pageDuePill')}</span>
        </div>
        <div id="toasts" role="status" aria-live="polite"></div>
      `;
      document.documentElement.append(host);
      uiRoot = shadow;
      return shadow;
    }

    function setDuePill(status?: ProblemStatus): void {
      currentStatus = status;
      const pill = mountUi().getElementById('due-pill');
      if (!(pill instanceof HTMLElement)) return;

      const text = mountUi().getElementById('due-text');
      if (text) text.textContent = t(locale, 'pageDuePill');

      const visible = Boolean(status?.tracked && status.due);
      pill.classList.toggle('visible', visible);
      if (visible && status?.nextReviewAt) {
        const dueAt = new Date(status.nextReviewAt);
        pill.title = Number.isNaN(dueAt.getTime())
          ? t(locale, 'pageDueNow')
          : t(locale, 'pageDueAt', { date: dueAt.toLocaleString(dateLanguage()) });
      } else {
        pill.removeAttribute('title');
      }
    }

    function showToast(message: string, tone: 'success' | 'neutral' | 'error' = 'neutral'): void {
      const container = mountUi().getElementById('toasts');
      if (!(container instanceof HTMLElement)) return;

      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.dataset.tone = tone;
      toast.textContent = message;
      container.append(toast);

      window.setTimeout(() => {
        toast.classList.add('leaving');
        window.setTimeout(() => toast.remove(), 200);
      }, 3200);
    }

    async function send(request: ExtensionRequest): Promise<ExtensionResponse> {
      try {
        const response = (await browser.runtime.sendMessage(request)) as ExtensionResponse | undefined;
        return response ?? { ok: false, error: '后台未返回结果' };
      } catch (error) {
        const message = error instanceof Error ? error.message : '无法连接扩展后台';
        return { ok: false, error: message };
      }
    }

    async function refreshLocale(): Promise<void> {
      const response = await send({ type: 'GET_LOCALE' });
      if (response.ok && typeof response.data === 'string') {
        locale = getLocale(response.data);
        setDuePill(currentStatus);
      }
    }

    async function refreshProblemStatus(slug: string, generation: number): Promise<void> {
      await refreshLocale();
      const response = await send({ type: 'GET_PROBLEM_STATUS', slug });
      if (generation !== routeGeneration || slug !== currentSlug) return;

      if (response.ok && isProblemStatus(response.data)) {
        setDuePill(response.data);
      } else {
        setDuePill();
      }
    }

    function scheduleHydration(generation: number, tryNumber = 0): void {
      if (hydrateTimer !== undefined) window.clearTimeout(hydrateTimer);

      hydrateTimer = window.setTimeout(() => {
        hydrateTimer = undefined;
        if (generation !== routeGeneration || !currentSlug || pageSeenSent) return;

        const problem = captureProblem(currentSlug);
        const metadataReady =
          problem.title !== humanizeSlug(currentSlug) &&
          problem.difficulty !== 'Unknown' &&
          problem.topics.length > 0;

        if (!metadataReady && tryNumber < 8) {
          scheduleHydration(generation, tryNumber + 1);
          return;
        }

        pageSeenSent = true;
        void (async () => {
          await send({ type: 'PAGE_SEEN', problem, seenAt: pageSeenAt });
          await refreshProblemStatus(problem.slug, generation);
        })();
      }, tryNumber === 0 ? 300 : 250);
    }

    function expose(level: Exclude<HintExposure, 'none'>): void {
      if (level === 'solution' || hintExposure === 'none') hintExposure = level;
    }

    function markExposureFromRoute(): void {
      if (/\/problems\/[^/]+\/(?:solutions?|editorial)(?:\/|$)/i.test(location.pathname)) {
        expose('solution');
      }
    }

    function handleRouteChange(): void {
      const slug = routeSlug();
      if (slug === currentSlug) {
        markExposureFromRoute();
        return;
      }

      routeGeneration += 1;
      currentSlug = slug;
      pendingAttempt = undefined;
      pageSeenSent = false;
      attemptNumber = 0;
      hintExposure = 'none';
      setDuePill();

      if (!slug) return;

      pageStartedAt = Date.now();
      pageSeenAt = new Date(pageStartedAt).toISOString();
      markExposureFromRoute();
      scheduleHydration(routeGeneration);
    }

    function isSubmitControl(control: Element): boolean {
      if (control.matches(SUBMIT_SELECTOR) || control.closest(SUBMIT_SELECTOR)) return true;
      if (!control.matches('button, [role="button"]')) return false;

      const label = compactText(
        `${control.getAttribute('aria-label') ?? ''} ${control.textContent ?? ''}`,
      ).toLowerCase();
      return label === 'submit' || label === '提交';
    }

    function markExposureFromControl(control: Element): void {
      if (!control.matches('a, button, [role="button"], [role="tab"], [aria-expanded]')) return;

      const href = control instanceof HTMLAnchorElement ? control.href : '';
      const marker = compactText(
        `${control.getAttribute('aria-label') ?? ''} ${control.getAttribute('data-e2e-locator') ?? ''} ${control.textContent ?? ''} ${href}`,
      );

      if (/\b(?:solution|solutions|editorial)\b|题解|官方解答/i.test(marker)) {
        expose('solution');
      } else if (/\bhints?\s*\d*\b|提示/i.test(marker)) {
        expose('hint');
      }
    }

    function beginAttempt(): void {
      if (!currentSlug) return;
      const clickedAt = Date.now();

      // Some layouts dispatch two synthetic clicks. Ignore only the immediate duplicate;
      // a later click replaces an abandoned pending submission.
      if (clickedAt - lastSubmitClickAt < 800) return;
      lastSubmitClickAt = clickedAt;
      attemptNumber += 1;

      const language = readLanguage();
      const baselineVerdict = currentVisibleVerdict();
      const pending: PendingAttempt = {
        id: uniqueEventId(currentSlug, clickedAt),
        problem: captureProblem(currentSlug),
        clickedAt,
        submittedAt: new Date(clickedAt).toISOString(),
        elapsedMs: Math.max(0, clickedAt - pageStartedAt),
        attemptNumber,
        hintExposure,
        ...(language ? { language } : {}),
        ...(baselineVerdict ? { baselineVerdict } : {}),
        sawTransition: false,
      };
      pendingAttempt = pending;

      const attemptId = pending.id;
      for (const delay of [250, 700, 1500, 3500]) {
        window.setTimeout(() => inspectCurrentResult(attemptId), delay);
      }
      window.setTimeout(() => {
        if (pendingAttempt?.id === attemptId) pendingAttempt = undefined;
      }, 120_000);
    }

    function inspectCurrentResult(attemptId: string): void {
      const pending = pendingAttempt;
      if (!pending || pending.id !== attemptId) return;

      const current = currentVisibleVerdict();
      if (!current) {
        // An old result disappearing is evidence that LeetCode started a new
        // judging cycle. On a fresh page there is no old result to replace, so
        // an empty result alone must not arm the fallback verdict detector.
        if (pending.baselineVerdict) pending.sawTransition = true;
        return;
      }

      if (pending.sawTransition || current !== pending.baselineVerdict) {
        completeAttempt(current);
      }
    }

    function mutationVerdict(records: MutationRecord[]): SubmissionVerdict | undefined {
      for (const record of records) {
        const nodes: Node[] = [];
        if (record.type === 'characterData') nodes.push(record.target);
        if (record.type === 'childList') nodes.push(...record.addedNodes);

        for (const node of nodes) {
          const element = elementForNode(node);
          if (!element || !isVisible(element)) continue;

          const text = node.textContent;
          const normalizedText = compactText(text);
          const inResultContainer = Boolean(
            element.matches(RESULT_SELECTOR) || element.closest(RESULT_SELECTOR),
          );
          if (inResultContainer && WAITING_RESULT.test(normalizedText)) {
            pendingAttempt!.sawTransition = true;
          }

          const verdict = verdictFromText(text);
          if (!verdict) continue;

          const exactVerdictNode = exactVerdictFromText(text) === verdict;
          // Prefer semantic result containers. The exact-text fallback is only
          // allowed after an observed judging transition, preventing unrelated
          // page copy such as a previous submission from becoming a new event.
          if (terminalBelongsToAttempt({
            verdict,
            ...(pendingAttempt!.baselineVerdict
              ? { baselineVerdict: pendingAttempt!.baselineVerdict }
              : {}),
            inResultContainer,
            exactVerdictNode,
            sawTransition: pendingAttempt!.sawTransition,
          })) {
            return verdict;
          }
        }
      }

      return undefined;
    }

    function completeAttempt(verdict: SubmissionVerdict): void {
      const pending = pendingAttempt;
      if (!pending) return;

      const remainingGuardMs = 150 - (Date.now() - pending.clickedAt);
      if (remainingGuardMs > 0) {
        const attemptId = pending.id;
        window.setTimeout(() => {
          if (pendingAttempt?.id === attemptId) completeAttempt(verdict);
        }, remainingGuardMs);
        return;
      }

      // Clear synchronously so repeated MutationObserver records cannot send duplicates.
      pendingAttempt = undefined;
      const capture: AttemptCapture = {
        eventId: pending.id,
        problem: pending.problem,
        submittedAt: pending.submittedAt,
        verdict,
        ...(pending.language ? { language: pending.language } : {}),
        elapsedMs: pending.elapsedMs,
        attemptNumber: pending.attemptNumber,
        hintExposure: pending.hintExposure,
      };

      void (async () => {
        let response: ExtensionResponse = { ok: false, error: '暂时无法连接扩展后台' };
        for (const delay of [0, 400, 1_200]) {
          if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay));
          response = await send({ type: 'RECORD_ATTEMPT', capture });
          if (response.ok) break;
        }
        await refreshLocale();
        if (!response.ok) {
          showToast(t(locale, 'captureFailed', { verdict: t(locale, VERDICT_KEYS[verdict]) }), 'error');
          return;
        }

        if (!isRecordAttemptResponse(response.data)) {
          showToast(t(locale, 'captureSaved', { verdict: t(locale, VERDICT_KEYS[verdict]) }), verdict === 'Accepted' ? 'success' : 'neutral');
          return;
        }

        if (response.data.duplicate) {
          showToast(t(locale, 'captureDuplicate'));
        } else if (response.data.accepted && response.data.nextReviewAt) {
          const nextReview = new Date(response.data.nextReviewAt);
          const suffix = Number.isNaN(nextReview.getTime())
            ? t(locale, 'reviewScheduled')
            : t(locale, 'nextReviewShort', { date: nextReview.toLocaleDateString(dateLanguage(), {
                month: 'numeric',
                day: 'numeric',
              }) });
          showToast(`${t(locale, 'verdictAccepted')} · ${suffix}`, 'success');
        } else if (!response.data.accepted && response.data.isReview && response.data.nextReviewAt) {
          const nextReview = new Date(response.data.nextReviewAt);
          const suffix = Number.isNaN(nextReview.getTime())
            ? t(locale, 'failureRescheduled')
            : t(locale, 'practiceAgain', { date: nextReview.toLocaleDateString(dateLanguage(), { month: 'numeric', day: 'numeric' }) });
          showToast(`${t(locale, VERDICT_KEYS[verdict])} · ${suffix}`, 'neutral');
        } else {
          showToast(t(locale, 'captureSaved', { verdict: t(locale, VERDICT_KEYS[verdict]) }), response.data.accepted ? 'success' : 'neutral');
        }

        if (currentSlug === pending.problem.slug) {
          await refreshProblemStatus(pending.problem.slug, routeGeneration);
        }
      })();
    }

    function inspectExposureMutation(record: MutationRecord): void {
      if (record.type !== 'attributes' || record.attributeName !== 'aria-expanded') return;

      const element = elementForNode(record.target);
      if (!element || !isVisible(element)) return;

      if (
        element.getAttribute('aria-expanded') === 'true'
      ) {
        markExposureFromControl(element);
      }
    }

    function handleClick(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const control = target.closest('a, button, [role="button"], [role="tab"], [aria-expanded]');
      if (!control) return;

      markExposureFromControl(control);
      if (isSubmitControl(control)) beginAttempt();
    }

    function handleKeydown(event: KeyboardEvent): void {
      if (event.repeat || event.altKey || event.shiftKey) return;
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) beginAttempt();
    }

    const observer = new MutationObserver((records) => {
      handleRouteChange();

      for (const record of records) inspectExposureMutation(record);

      if (pendingAttempt) {
        const verdict = mutationVerdict(records);
        if (verdict) completeAttempt(verdict);
        else if (pendingAttempt.baselineVerdict && !currentVisibleVerdict()) {
          pendingAttempt.sawTransition = true;
        }
      }
    });

    mountUi();
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-expanded'],
    });
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeydown, true);
    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);
    window.addEventListener('focus', () => void refreshLocale());
    navigationTimer = window.setInterval(handleRouteChange, 750);
    handleRouteChange();
    void refreshLocale();

    // Retain the timer reference to make the content script lifecycle explicit.
    void navigationTimer;
  },
});
