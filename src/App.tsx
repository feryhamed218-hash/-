import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ClipboardCopy,
  Download,
  ExternalLink,
  FlaskConical,
  Globe,
  MessageSquare,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  Terminal,
  XCircle,
} from 'lucide-react';
import { getFullAgentBlueprint } from './agent/blueprintExporter.ts';
import { DEFAULT_USER_LIFESTYLE_MEMORY } from './agent/memoryConfig.ts';
import { CONVERSATION_STARTERS, WELCOME_MESSAGE } from './agent/starters.ts';
import type {
  AgentTurnResponse,
  MemoryConsentRequest,
  QualityTestResult,
  StructuredSchedulePlan,
  ToolExecutionTrace,
  UserLifestyleMemory,
} from './agent/types.ts';

type ActiveTab = 'chat' | 'blueprint' | 'tests' | 'canva';
type BlueprintSection =
  | 'instructions'
  | 'categories'
  | 'knowledge'
  | 'decision'
  | 'scenarios'
  | 'schema'
  | 'memory';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

const BLUEPRINT = getFullAgentBlueprint();
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';

function detectStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return (
    window.location.pathname === '/ann' ||
    params.get('mode') === 'standalone'
  );
}

export default function App() {
  const [isStandalone, setIsStandalone] = useState<boolean>(detectStandaloneMode);
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [blueprintSection, setBlueprintSection] =
    useState<BlueprintSection>('instructions');

  // Chat sandbox state
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'model', text: WELCOME_MESSAGE },
  ]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [latestSchedule, setLatestSchedule] =
    useState<StructuredSchedulePlan | null>(null);
  const [toolTrace, setToolTrace] = useState<ToolExecutionTrace[]>([]);
  const [memory, setMemory] = useState<UserLifestyleMemory>(
    DEFAULT_USER_LIFESTYLE_MEMORY
  );
  const [pendingConsent, setPendingConsent] =
    useState<MemoryConsentRequest | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Quality tests state
  const [testResults, setTestResults] = useState<
    Record<number, QualityTestResult>
  >({});
  const [runningTestId, setRunningTestId] = useState<number | null>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  useEffect(() => {
    if (!copiedId) return;
    const timer = setTimeout(() => setCopiedId(null), 1800);
    return () => clearTimeout(timer);
  }, [copiedId]);

  const hasUserStarted = messages.some((m) => m.role === 'user');

  async function sendMessage(textToSend: string) {
    const trimmed = textToSend.trim();
    if (!trimmed || isSending) return;

    setChatError(null);
    setPendingConsent(null);

    const historyForApi = messages
      .filter((_, idx) => idx > 0)
      .map((m) => ({ role: m.role, text: m.text }));

    // Add user message + empty placeholder for streaming model reply
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: trimmed },
      { role: 'model', text: '' },
    ]);
    setInputText('');
    setIsSending(true);

    try {
      const res = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: historyForApi,
          message: trimmed,
          memory,
        }),
      });

      if (!res.ok || !res.body) {
        const errData = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errData.error || 'تعذر الاتصال بالمساعد الذكي.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let currentEvent = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trimEnd();
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const jsonText = line.slice(5).trim();
            if (!jsonText) continue;
            const payload = JSON.parse(jsonText);

            if (currentEvent === 'delta' && payload.text) {
              setMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx >= 0 && updated[lastIdx].role === 'model') {
                  updated[lastIdx] = {
                    role: 'model',
                    text: updated[lastIdx].text + String(payload.text),
                  };
                }
                return updated;
              });
            } else if (currentEvent === 'tool') {
              setToolTrace((prev) => [...prev, payload as ToolExecutionTrace]);
            } else if (currentEvent === 'done') {
              const finalData = payload as AgentTurnResponse;
              if (finalData.replyText) {
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  if (lastIdx >= 0 && updated[lastIdx].role === 'model') {
                    updated[lastIdx] = {
                      role: 'model',
                      text: finalData.replyText,
                    };
                  }
                  return updated;
                });
              }
              if (finalData.structuredSchedule) {
                setLatestSchedule(finalData.structuredSchedule);
              }
              if (finalData.updatedMemory) {
                setMemory(finalData.updatedMemory);
              }
              if (finalData.memoryConsentRequest?.requested) {
                setPendingConsent(finalData.memoryConsentRequest);
              }
            } else if (currentEvent === 'error') {
              throw new Error(payload.error || 'حدث خطأ أثناء الرد.');
            }
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev];
        if (
          updated.length > 0 &&
          updated[updated.length - 1].role === 'model' &&
          !updated[updated.length - 1].text
        ) {
          updated.pop();
        }
        return updated;
      });
      setChatError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setIsSending(false);
    }
  }

  async function handleMemoryConsentDecision(allow: boolean) {
    try {
      const res = await fetch(`${API_BASE}/api/memory/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentMemory: memory,
          consentGranted: allow,
        }),
      });
      const data = (await res.json()) as { memory: UserLifestyleMemory };
      setMemory(data.memory);
      setPendingConsent(null);
      if (allow) {
        await sendMessage('نعم، أوافق على حفظ تفضيلات نمط حياتي في الذاكرة.');
      }
    } catch (err) {
      setChatError(
        err instanceof Error ? err.message : 'تعذر تحديث إعدادات الموافقة'
      );
    }
  }

  function resetConversation() {
    setMessages([{ role: 'model', text: WELCOME_MESSAGE }]);
    setLatestSchedule(null);
    setToolTrace([]);
    setPendingConsent(null);
    setChatError(null);
  }

  function copyText(id: string, content: string) {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
  }

  function downloadFullManifest() {
    const blob = new Blob([JSON.stringify(BLUEPRINT, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ann-ai-agent-blueprint.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runSingleTest(testId: number) {
    setTestError(null);
    setRunningTestId(testId);
    try {
      const res = await fetch(`${API_BASE}/api/tests/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testId }),
      });
      const data = (await res.json()) as QualityTestResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `فشل تشغيل الاختبار #${testId}`);
      }
      setTestResults((prev) => ({ ...prev, [testId]: data }));
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'تعذر تشغيل الاختبار');
    } finally {
      setRunningTestId(null);
    }
  }

  async function runAllTests() {
    if (isRunningAll) return;
    setIsRunningAll(true);
    setTestError(null);
    for (const testCase of BLUEPRINT.qualityTests) {
      await runSingleTest(testCase.id);
    }
    setIsRunningAll(false);
  }

  const standaloneUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/ann`
      : '/ann';

  // Clean Standalone View (for separated site / Canva external link)
  if (isStandalone) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center p-3 sm:p-6">
        <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col h-[88vh]">
          <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h1 className="font-bold text-base text-slate-900">
                {BLUEPRINT.identity.displayName}
              </h1>
              <p className="text-xs text-slate-500">
                {BLUEPRINT.identity.philosophy}
              </p>
            </div>
            <button
              type="button"
              onClick={resetConversation}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>محادثة جديدة</span>
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${
                  msg.role === 'user' ? 'justify-start' : 'justify-end'
                }`}
              >
                <div
                  className={`max-w-[88%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-900 border border-slate-200'
                  }`}
                >
                  {msg.text || (isSending && idx === messages.length - 1 ? '...' : '')}
                </div>
              </div>
            ))}

            {!hasUserStarted && (
              <div className="pt-2">
                <div className="flex flex-wrap gap-2">
                  {CONVERSATION_STARTERS.map((starter) => (
                    <button
                      key={starter.id}
                      type="button"
                      disabled={isSending}
                      onClick={() => sendMessage(starter.text)}
                      className="text-right text-xs sm:text-sm px-3.5 py-2 rounded-lg bg-white border border-slate-300 hover:border-slate-900 hover:bg-slate-50 transition text-slate-800"
                    >
                      {starter.text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {pendingConsent?.requested && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs space-y-2">
                <div className="font-semibold text-amber-900">
                  هل تسمح بحفظ تفضيلات يومك لتسهيل التخطيط لاحقًا؟
                </div>
                <p className="text-amber-800">{pendingConsent.reasonAr}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleMemoryConsentDecision(true)}
                    className="px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-800"
                  >
                    موافقة على الحفظ
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMemoryConsentDecision(false)}
                    className="px-3 py-1.5 rounded bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                  >
                    لا، شكرًا
                  </button>
                </div>
              </div>
            )}

            {chatError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {chatError}
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(inputText);
            }}
            className="p-3 sm:p-4 border-t border-slate-200 flex gap-2"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="احكي لـ آن يومك ماشي إزاي..."
              className="flex-1 px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-slate-900"
              disabled={isSending}
            />
            <button
              type="submit"
              disabled={isSending || !inputText.trim()}
              className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Send className="w-4 h-4" />
              <span>إرسال</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Minimal Developer Agent Header */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg text-slate-900">
                {BLUEPRINT.identity.displayName}
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-mono">
                v{BLUEPRINT.agentVersion}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              بيئة تشغيل وفحص العقل الذكي للمساعد — بث فوري للردود وجاهز للنشر
              المستقل والربط مع Canva
            </p>
          </div>

          <nav className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                activeTab === 'chat'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>محادثة الاختبار الحي</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('blueprint')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                activeTab === 'blueprint'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>مكونات العقل الذكي</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('tests')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                activeTab === 'tests'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <FlaskConical className="w-4 h-4" />
              <span>اختبارات الجودة (12)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('canva')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                activeTab === 'canva'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Globe className="w-4 h-4" />
              <span>النشر المستقل و Canva</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6">
        {activeTab === 'chat' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Conversation Sandbox */}
            <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl flex flex-col h-[78vh]">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-sm text-slate-900">
                    اختبار تفاعل «آن | Ann» (بث فوري SSE)
                  </h2>
                  <p className="text-xs text-slate-500">
                    {BLUEPRINT.identity.philosophy}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsStandalone(true)}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>معاينة الصفحة المستقلة</span>
                  </button>
                  <button
                    type="button"
                    onClick={resetConversation}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>جلسة جديدة</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${
                      msg.role === 'user' ? 'justify-start' : 'justify-end'
                    }`}
                  >
                    <div
                      className={`max-w-[88%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-900 border border-slate-200'
                      }`}
                    >
                      <div className="text-[11px] font-semibold mb-1 opacity-70">
                        {msg.role === 'user' ? 'المستخدم' : 'آن | Ann'}
                      </div>
                      {msg.text ||
                        (isSending && idx === messages.length - 1
                          ? 'جاري الكتابة...'
                          : '')}
                    </div>
                  </div>
                ))}

                {!hasUserStarted && (
                  <div className="pt-2">
                    <p className="text-xs font-medium text-slate-500 mb-2">
                      اختر نقطة بداية (تُرسل كرسالة حقيقية للمساعد):
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {CONVERSATION_STARTERS.map((starter) => (
                        <button
                          key={starter.id}
                          type="button"
                          disabled={isSending}
                          onClick={() => sendMessage(starter.text)}
                          className="text-right text-xs sm:text-sm px-3 py-2 rounded-lg bg-white border border-slate-300 hover:border-slate-900 hover:bg-slate-50 transition text-slate-800"
                        >
                          {starter.text}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {pendingConsent?.requested && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs space-y-2">
                    <div className="font-semibold text-amber-900">
                      طلب إذن حفظ في الذاكرة (المبدأ 11):
                    </div>
                    <p className="text-amber-800">{pendingConsent.reasonAr}</p>
                    {pendingConsent.proposedFieldsSummaryAr.length > 0 && (
                      <ul className="list-disc list-inside text-amber-800">
                        {pendingConsent.proposedFieldsSummaryAr.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleMemoryConsentDecision(true)}
                        className="px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-800"
                      >
                        موافقة على الحفظ
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMemoryConsentDecision(false)}
                        className="px-3 py-1.5 rounded bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                      >
                        رفض (تجاهل)
                      </button>
                    </div>
                  </div>
                )}

                {chatError && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                    {chatError}
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMessage(inputText);
                }}
                className="p-3 border-t border-slate-200 flex gap-2"
              >
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="اكتب ظروف يومك أو اسأل آن..."
                  className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                  disabled={isSending}
                />
                <button
                  type="submit"
                  disabled={isSending || !inputText.trim()}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Send className="w-4 h-4" />
                  <span>إرسال</span>
                </button>
              </form>
            </section>

            {/* Structured JSON & Memory Inspector Panel */}
            <aside className="lg:col-span-5 space-y-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 font-semibold text-sm">
                    <ShieldCheck className="w-4 h-4 text-slate-700" />
                    <span>حالة الذاكرة والتخصيص (المبدأ 11)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      handleMemoryConsentDecision(!memory.consentGranted)
                    }
                    className={`text-xs px-2.5 py-1 rounded border ${
                      memory.consentGranted
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                        : 'bg-slate-100 border-slate-300 text-slate-700'
                    }`}
                  >
                    {memory.consentGranted
                      ? 'الموافقة مفعلة (اضغط للإلغاء)'
                      : 'غير مفعلة (تفعيل بموافقة)'}
                  </button>
                </div>
                <pre
                  dir="ltr"
                  className="text-[11px] bg-slate-950 text-slate-100 p-3 rounded-lg overflow-x-auto max-h-40"
                >
                  {JSON.stringify(memory, null, 2)}
                </pre>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 font-semibold text-sm">
                    <Terminal className="w-4 h-4 text-slate-700" />
                    <span>مخرجات JSON للساعة الدائرية</span>
                  </div>
                  {latestSchedule && (
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          'schedule',
                          JSON.stringify(latestSchedule, null, 2)
                        )
                      }
                      className="text-xs flex items-center gap-1 text-slate-600 hover:text-slate-900"
                    >
                      <ClipboardCopy className="w-3.5 h-3.5" />
                      <span>{copiedId === 'schedule' ? 'تم النسخ' : 'نسخ'}</span>
                    </button>
                  )}
                </div>
                {latestSchedule ? (
                  <pre
                    dir="ltr"
                    className="text-[11px] bg-slate-950 text-emerald-300 p-3 rounded-lg overflow-auto max-h-64"
                  >
                    {JSON.stringify(latestSchedule, null, 2)}
                  </pre>
                ) : (
                  <p className="text-xs text-slate-500">
                    عند اكتمال المعلومات وبناء خطة، ستظهر هنا البيانات المنظمة
                    المولدة من أداة <code>publish_structured_schedule</code> جاهزة
                    للربط بالساعة الدائرية.
                  </p>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="font-semibold text-sm mb-2">
                  سجل استدعاء أدوات القرار ({toolTrace.length})
                </div>
                {toolTrace.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    لم تُستدعَ أدوات تصنيف أو جدولة في هذه الجلسة بعد.
                  </p>
                ) : (
                  <pre
                    dir="ltr"
                    className="text-[11px] bg-slate-950 text-slate-200 p-3 rounded-lg overflow-auto max-h-44"
                  >
                    {JSON.stringify(toolTrace, null, 2)}
                  </pre>
                )}
              </div>
            </aside>
          </div>
        )}

        {activeTab === 'blueprint' && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <h2 className="font-bold text-base">
                  مكونات العقل الذكي الكاملة — «آن | Ann»
                </h2>
                <p className="text-xs text-slate-600">
                  جميع التعليمات، قاعدة المعرفة، قواعد القرار، السيناريوهات،
                  والعقود البرمجية جاهزة للنسخ أو التصدير والربط.
                </p>
              </div>
              <button
                type="button"
                onClick={downloadFullManifest}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800"
              >
                <Download className="w-4 h-4" />
                <span>تحميل الحزمة الكاملة (JSON)</span>
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['instructions', '1. System Instructions'],
                  ['categories', '2. الأقسام الستة الثابتة'],
                  ['knowledge', '3. قاعدة المعرفة (8 مجالات)'],
                  ['decision', '4. خوارزمية التفكير والمبادئ الـ 12'],
                  ['scenarios', '5. السيناريوهات التدريبية'],
                  ['schema', '6. تنسيق JSON للساعة الدائرية'],
                  ['memory', '7. إعدادات الذاكرة والتخصيص'],
                ] as Array<[BlueprintSection, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBlueprintSection(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                    blueprintSection === key
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {blueprintSection === 'instructions' && (
              <div className="space-y-2">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      copyText('sys', BLUEPRINT.systemInstructions)
                    }
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-50"
                  >
                    <ClipboardCopy className="w-3.5 h-3.5" />
                    <span>
                      {copiedId === 'sys'
                        ? 'تم نسخ التعليمات'
                        : 'نسخ System Instructions'}
                    </span>
                  </button>
                </div>
                <pre className="bg-slate-950 text-slate-100 p-4 rounded-xl text-xs leading-relaxed whitespace-pre-wrap overflow-auto max-h-[62vh]">
                  {BLUEPRINT.systemInstructions}
                </pre>
              </div>
            )}

            {blueprintSection === 'categories' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                  <div className="font-bold text-sm">
                    التقسيمة الأساسية المرجعية (البيسك — دورة{' '}
                    {BLUEPRINT.basicBaselineDistribution.cycleDurationHours} ساعة
                    نشطة)
                  </div>
                  <p className="text-xs text-slate-600">
                    {BLUEPRINT.basicBaselineDistribution.descriptionAr}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-1">
                    {BLUEPRINT.basicBaselineDistribution.segments.map((seg) => (
                      <div
                        key={seg.category}
                        className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs"
                      >
                        <div className="font-bold text-slate-900">
                          {seg.clockLabelAr}
                        </div>
                        <div className="text-slate-600 mt-1">
                          {seg.defaultHoursIn12hCycle} ساعة (
                          {seg.percentageOfActiveCycle}%)
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {BLUEPRINT.sixCoreCategories.map((cat, i) => (
                    <div
                      key={cat.id}
                      className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm">
                          {i + 1}. {cat.nameAr}
                        </span>
                        <code className="text-[11px] bg-white px-2 py-0.5 rounded border border-slate-200">
                          {cat.id}
                        </code>
                      </div>
                      <p className="text-xs text-slate-700">{cat.descriptionAr}</p>
                      <p className="text-xs text-slate-600">
                        <strong>السبب:</strong> {cat.reasonAr}
                      </p>
                      <p className="text-xs text-slate-600">
                        <strong>عند التداخل:</strong>{' '}
                        {cat.ambiguousOverlapHintsAr}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {blueprintSection === 'knowledge' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {BLUEPRINT.knowledgeBase.map((domain) => (
                  <div
                    key={domain.id}
                    className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-2"
                  >
                    <h3 className="font-bold text-sm">{domain.titleAr}</h3>
                    <ul className="list-disc list-inside text-xs text-slate-700 space-y-1">
                      {domain.rulesAr.map((r, idx) => (
                        <li key={idx}>{r}</li>
                      ))}
                    </ul>
                    <div className="text-xs text-slate-600 pt-1 border-t border-slate-200">
                      <strong>محفزات القرار:</strong>{' '}
                      {domain.decisionTriggersAr.join(' ')}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {blueprintSection === 'decision' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                  <h3 className="font-bold text-sm">
                    خطوات التفكير الـ 12 بالترتيب
                  </h3>
                  <ul className="text-xs text-slate-700 space-y-1.5">
                    {BLUEPRINT.thinkingSteps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ul>
                </div>
                <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                  <h3 className="font-bold text-sm">
                    المبادئ الـ 12 التي لا يمكن تجاوزها
                  </h3>
                  <ul className="text-xs text-slate-700 space-y-1.5">
                    {BLUEPRINT.nonNegotiablePrinciples.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {blueprintSection === 'scenarios' && (
              <div className="space-y-3">
                {BLUEPRINT.trainingScenarios.map((sc) => (
                  <div
                    key={sc.id}
                    className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-2"
                  >
                    <h3 className="font-bold text-sm">{sc.titleAr}</h3>
                    <p className="text-xs bg-white p-2 rounded border border-slate-200">
                      <strong>رسالة المستخدم:</strong> {sc.userMessage}
                    </p>
                    <ul className="list-disc list-inside text-xs text-slate-700 space-y-1">
                      {sc.agentReasoningChecklistAr.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                    <p className="text-xs text-emerald-900 bg-emerald-50 p-2 rounded border border-emerald-200">
                      <strong>الرد النموذجي:</strong> {sc.idealResponseAr}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {blueprintSection === 'schema' && (
              <div className="space-y-2">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        'schema',
                        JSON.stringify(BLUEPRINT.scheduleJsonSchema, null, 2)
                      )
                    }
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-50"
                  >
                    <ClipboardCopy className="w-3.5 h-3.5" />
                    <span>
                      {copiedId === 'schema' ? 'تم النسخ' : 'نسخ JSON Schema'}
                    </span>
                  </button>
                </div>
                <pre
                  dir="ltr"
                  className="bg-slate-950 text-emerald-300 p-4 rounded-xl text-xs overflow-auto max-h-[60vh]"
                >
                  {JSON.stringify(BLUEPRINT.scheduleJsonSchema, null, 2)}
                </pre>
              </div>
            )}

            {blueprintSection === 'memory' && (
              <div className="space-y-3">
                <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 text-xs space-y-2">
                  <p>
                    <strong>سياسة الذاكرة:</strong>{' '}
                    {BLUEPRINT.memorySpecification.policySummaryAr}
                  </p>
                  <p>
                    <strong>قاعدة الموافقة:</strong>{' '}
                    {BLUEPRINT.memorySpecification.consentRuleAr}
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {BLUEPRINT.memorySpecification.dimensions.map((dim) => (
                    <div
                      key={dim.id}
                      className="p-3 rounded-lg border border-slate-200 bg-white space-y-1.5"
                    >
                      <h4 className="font-bold text-xs">{dim.titleAr}</h4>
                      <ul className="list-disc list-inside text-xs text-slate-600 space-y-0.5">
                        {dim.fields.map((f) => (
                          <li key={f.key}>{f.labelAr}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'tests' && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <h2 className="font-bold text-base">
                  اختبارات جودة المساعد (12 سيناريو حقيقي)
                </h2>
                <p className="text-xs text-slate-600">
                  تقييم حي لقدرة «آن | Ann» على التفكير المرن والواقعي وطلب
                  المعلومات الناقصة بدل التخمين.
                </p>
              </div>
              <button
                type="button"
                disabled={isRunningAll || runningTestId !== null}
                onClick={runAllTests}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                <span>
                  {isRunningAll
                    ? 'جاري تشغيل جميع الاختبارات...'
                    : 'تشغيل الـ 12 اختبارًا بالتتابع'}
                </span>
              </button>
            </div>

            {testError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {testError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {BLUEPRINT.qualityTests.map((tc) => {
                const res = testResults[tc.id];
                const isRunningThis = runningTestId === tc.id;

                return (
                  <div
                    key={tc.id}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-bold text-sm text-slate-900">
                          {tc.id}. {tc.questionAr}
                        </span>
                        <button
                          type="button"
                          disabled={isRunningThis || isRunningAll}
                          onClick={() => runSingleTest(tc.id)}
                          className="shrink-0 px-2.5 py-1 rounded bg-white border border-slate-300 text-xs hover:bg-slate-100 disabled:opacity-50"
                        >
                          {isRunningThis ? 'جاري...' : 'اختبار'}
                        </button>
                      </div>
                      <p className="text-xs text-slate-600">
                        <strong>التركيز:</strong> {tc.focusAreaAr}
                      </p>

                      {res && (
                        <div className="mt-2 p-3 rounded-lg bg-white border border-slate-200 space-y-2 text-xs">
                          <div className="flex items-center justify-between">
                            <span
                              className={`flex items-center gap-1 font-bold ${
                                res.passed
                                  ? 'text-emerald-700'
                                  : 'text-red-700'
                              }`}
                            >
                              {res.passed ? (
                                <CheckCircle2 className="w-4 h-4" />
                              ) : (
                                <XCircle className="w-4 h-4" />
                              )}
                              {res.passed ? 'اجتاز الاختبار' : 'يحتاج مراجعة'}
                            </span>
                            <span className="font-mono font-bold text-slate-800">
                              {res.score}/100
                            </span>
                          </div>

                          <div className="p-2 rounded bg-slate-50 border border-slate-200 text-slate-800 whitespace-pre-wrap">
                            {res.agentReplyAr}
                          </div>

                          <ul className="space-y-1">
                            {res.checks.map((chk, idx) => (
                              <li
                                key={idx}
                                className="flex items-start gap-1.5 text-[11px]"
                              >
                                <span
                                  className={
                                    chk.passed
                                      ? 'text-emerald-600'
                                      : 'text-red-600'
                                  }
                                >
                                  {chk.passed ? '✓' : '✗'}
                                </span>
                                <span>
                                  <strong>{chk.criterion}:</strong> {chk.note}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'canva' && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-6">
            <div className="border-b border-slate-200 pb-4">
              <h2 className="font-bold text-base">
                تشغيل «آن | Ann» على موقع منفصل وربطه تفاعليًا بـ Canva
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                تم تجهيز مسار مستقل نظيف (<code>/ann</code>) خالٍ من أدوات المطورين
                أو واجهة Google AI، ليكون هو الصفحة التي يفتحها المستخدم عند الضغط
                على الرابط داخل تصميمك في Canva.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                <h3 className="font-bold text-sm">
                  1. معاينة الصفحة المستقلة الجاهزة للزائر
                </h3>
                <p className="text-xs text-slate-700 leading-relaxed">
                  المسار <code>/ann</code> يفتح محادثة «آن | Ann» مباشرة فقط
                  (الرسالة الترحيبية + الاقتراحات الخمسة + البث الفوري السريع)،
                  بدون تبويبات الفحص والبرمجة.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsStandalone(true)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>معاينة وضع /ann الآن</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText('standalone-url', standaloneUrl)}
                    className="flex items-center gap-1 text-xs px-3 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-100"
                  >
                    <ClipboardCopy className="w-3.5 h-3.5" />
                    <span>
                      {copiedId === 'standalone-url'
                        ? 'تم نسخ المسار'
                        : 'نسخ رابط /ann الحالي'}
                    </span>
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <h3 className="font-bold text-sm">
                  2. كيف تنقله لموقع منفصل خارج Google AI Studio؟
                </h3>
                <ol className="list-decimal list-inside text-xs text-slate-700 space-y-1.5 leading-relaxed">
                  <li>
                    حمّل ملفات المشروع (تصدير/تنزيل الكود أو رفعه على GitHub).
                  </li>
                  <li>
                    ارفعه على أي منصة استضافة مستقلة تدعم Node.js مثل{' '}
                    <strong>Render</strong> أو <strong>Railway</strong> أو{' '}
                    <strong>Google Cloud Run</strong> أو <strong>Fly.io</strong>.
                  </li>
                  <li>
                    اضبط أمر البناء <code>npm run build</code> وأمر التشغيل{' '}
                    <code>npm start</code> (يعمل بـ <code>node server.ts</code>{' '}
                    مباشرة) وأضف متغير البيئة <code>GEMINI_API_KEY</code>.
                  </li>
                  <li>
                    ستحصل على رابط خاص بك تمامًا (مثل{' '}
                    <code>https://ann-planner.onrender.com/ann</code> أو{' '}
                    <code>https://ann.yourdomain.com/ann</code>).
                  </li>
                </ol>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
              <h3 className="font-bold text-sm">
                3. خطوات الربط التفاعلي داخل Canva
              </h3>
              <ol className="list-decimal list-inside text-xs text-slate-700 space-y-1.5 leading-relaxed">
                <li>
                  افتح تصميمك أو موقعك في <strong>Canva</strong> وحدد الزر أو
                  البطاقة أو النص (مثل: «تحدث مع آن | نظّم يومك الآن»).
                </li>
                <li>
                  من الشريط العلوي اضغط على أيقونة <strong>الرابط (Link)</strong>{' '}
                  أو اختصار <code>Ctrl+K</code> / <code>Cmd+K</code>.
                </li>
                <li>
                  الصق رابط الموقع المنفصل متبوعًا بـ <code>/ann</code> (مثال:{' '}
                  <code>https://your-separated-site.com/ann</code>).
                </li>
                <li>
                  عند مشاركة تصميم Canva أو نشره، بمجرد الضغط على الزر سينتقل
                  المستخدم مباشرة إلى صفحة «آن | Ann» التفاعلية المستقلة خارج
                  Google AI.
                </li>
              </ol>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
