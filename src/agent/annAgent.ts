import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type Content,
  type Part,
} from '@google/genai';
import {
  ANN_FUNCTION_DECLARATIONS,
  formatScheduleAsMarkdown,
  formatScheduleCategoryLabel,
  validateSchedulePlan,
} from './decisionRules.ts';
import { DEFAULT_USER_LIFESTYLE_MEMORY, mergeConsentedMemory } from './memoryConfig.ts';
import { QUALITY_TEST_CASES } from './qualityTests.ts';
import { buildAnnRuntimeSystemInstructions } from './systemInstructions.ts';
import type {
  AgentTurnResponse,
  MemoryConsentRequest,
  QualityTestCase,
  QualityTestResult,
  ScheduleCategoryId,
  StructuredSchedulePlan,
  ToolExecutionTrace,
  UserLifestyleMemory,
} from './types.ts';

const MODEL_NAME = 'gemini-3.1-flash-lite';

let cachedAiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment variables.');
  }
  if (!cachedAiClient) {
    cachedAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedAiClient;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('429') ||
        msg.includes('503') ||
        msg.includes('500') ||
        msg.includes('UNAVAILABLE');
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

export interface ChatTurnInput {
  history: Array<{ role: 'user' | 'model'; text: string }>;
  userMessage: string;
  memory?: UserLifestyleMemory;
}

function executeAnnToolCall(
  toolName: string,
  args: Record<string, unknown>,
  state: {
    currentMemory: UserLifestyleMemory;
    structuredSchedule: StructuredSchedulePlan | null;
    memoryConsentRequest: MemoryConsentRequest | null;
  }
): Record<string, unknown> {
  if (toolName === 'classify_activity') {
    const primary = String(args.primaryCategory ?? 'WORK_OR_STUDY') as ScheduleCategoryId;
    const alt = args.alternativeCategory
      ? (String(args.alternativeCategory) as ScheduleCategoryId)
      : undefined;
    return {
      status: 'classified',
      activityName: args.activityName,
      primaryCategory: primary,
      primaryCategoryLabelAr: formatScheduleCategoryLabel(primary),
      alternativeCategory: alt ?? null,
      alternativeCategoryLabelAr: alt ? formatScheduleCategoryLabel(alt) : null,
      reasonAr: args.reasonAr,
    };
  }

  if (toolName === 'publish_structured_schedule') {
    const rawPlan = args as unknown as StructuredSchedulePlan;
    const validation = validateSchedulePlan(rawPlan);
    state.structuredSchedule = validation.normalizedPlan;
    return {
      status: validation.valid ? 'published' : 'published_with_conflicts',
      valid: validation.valid,
      conflicts: validation.conflicts,
      warnings: validation.warnings,
      activityCount: validation.normalizedPlan.activities.length,
    };
  }

  if (toolName === 'request_or_update_memory') {
    const action = String(args.action ?? 'REQUEST_CONSENT');
    const proposedFields = Array.isArray(args.proposedFieldsSummaryAr)
      ? (args.proposedFieldsSummaryAr as string[])
      : [];
    const reasonAr = String(args.reasonAr ?? '');

    if (action === 'SAVE_WITH_CONSENT' && state.currentMemory.consentGranted) {
      state.currentMemory = mergeConsentedMemory(state.currentMemory, {
        consentGranted: true,
        dayTiming: {
          ...(args.wakeUpTime ? { wakeUpTime: String(args.wakeUpTime) } : {}),
          ...(args.sleepTime ? { sleepTime: String(args.sleepTime) } : {}),
          ...(args.actualDayStart ? { actualDayStart: String(args.actualDayStart) } : {}),
          ...(Array.isArray(args.peakFocusWindows)
            ? { peakFocusWindows: args.peakFocusWindows.map(String) }
            : {}),
        },
        studyAndWork: {
          ...(Array.isArray(args.fixedCommitments)
            ? { fixedCommitments: args.fixedCommitments.map(String) }
            : {}),
        },
        physicalActivity: {
          ...(typeof args.gymDaysPerWeek === 'number'
            ? { gymDaysPerWeek: args.gymDaysPerWeek }
            : {}),
          ...(Array.isArray(args.workoutDays)
            ? { workoutDays: args.workoutDays.map(String) }
            : {}),
        },
        goals: {
          ...(Array.isArray(args.skillsToLearn)
            ? { skillsToLearn: args.skillsToLearn.map(String) }
            : {}),
          ...(Array.isArray(args.habitsToBuild)
            ? { habitsToBuild: args.habitsToBuild.map(String) }
            : {}),
        },
      });
      return {
        status: 'saved',
        consentGranted: true,
      };
    }

    state.memoryConsentRequest = {
      requested: true,
      proposedFieldsSummaryAr: proposedFields,
      reasonAr,
    };
    return {
      status: 'consent_required',
      consentGranted: false,
      message:
        'لا يمكن حفظ البيانات الشخصية قبل موافقة المستخدم الصريحة (المبدأ 11). اعرض طلب الموافقة على المستخدم بوضوح.',
    };
  }

  return { status: 'unknown_tool' };
}

function sanitizeAnnReply(text: string): string {
  return text
    .replace(/\bWORK_OR_STUDY\b/g, 'شغل أو دراسة')
    .replace(/\bPHYSICAL_ACTIVITY\b/g, 'نشاط بدني')
    .replace(/\bDAILY_TASKS\b/g, 'مهام يومية')
    .replace(/\bLEARNING_AND_GROWTH\b/g, 'تعلّم أو إنجاز إضافي')
    .replace(/\bFLEXIBLE_TIME\b/g, 'وقت مرن')
    .replace(/\bREST\b/g, 'راحة')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export async function runAnnAgentTurn(input: ChatTurnInput): Promise<AgentTurnResponse> {
  const ai = getGeminiClient();
  const state: {
    currentMemory: UserLifestyleMemory;
    structuredSchedule: StructuredSchedulePlan | null;
    memoryConsentRequest: MemoryConsentRequest | null;
  } = {
    currentMemory: input.memory
      ? { ...input.memory }
      : { ...DEFAULT_USER_LIFESTYLE_MEMORY },
    structuredSchedule: null,
    memoryConsentRequest: null,
  };

  const systemInstruction = buildAnnRuntimeSystemInstructions(state.currentMemory);

  const contents: Content[] = [
    ...input.history.map((msg) => ({
      role: msg.role,
      parts: [{ text: msg.text }],
    })),
    {
      role: 'user',
      parts: [{ text: input.userMessage }],
    },
  ];

  const toolTrace: ToolExecutionTrace[] = [];
  const maxToolRounds = 4;
  let finalReplyText = '';

  for (let round = 0; round < maxToolRounds; round++) {
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: MODEL_NAME,
        contents,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          tools: [{ functionDeclarations: ANN_FUNCTION_DECLARATIONS }],
        },
      })
    );

    const candidateContent = response.candidates?.[0]?.content;
    const functionCalls = response.functionCalls;

    if (!functionCalls || functionCalls.length === 0 || !candidateContent) {
      finalReplyText = (response.text ?? '').trim();
      break;
    }

    contents.push(candidateContent);

    const functionResponseParts: Part[] = [];
    for (const call of functionCalls) {
      const args = (call.args ?? {}) as Record<string, unknown>;
      const toolName = call.name ?? 'unknown';
      const toolResult = executeAnnToolCall(toolName, args, state);

      toolTrace.push({ toolName, args, result: toolResult });
      functionResponseParts.push({
        functionResponse: {
          id: call.id,
          name: toolName,
          response: toolResult,
        },
      });
    }

    contents.push({
      role: 'user',
      parts: functionResponseParts,
    });

    if (state.structuredSchedule && !finalReplyText) {
      finalReplyText = formatScheduleAsMarkdown(state.structuredSchedule);
      break;
    }
  }

  if (!finalReplyText && state.structuredSchedule) {
    finalReplyText = formatScheduleAsMarkdown(state.structuredSchedule);
  }

  return {
    replyText: sanitizeAnnReply(finalReplyText),
    structuredSchedule: state.structuredSchedule,
    memoryConsentRequest: state.memoryConsentRequest,
    updatedMemory: state.currentMemory,
    toolTrace,
  };
}

export interface StreamCallbacks {
  onTextDelta: (delta: string) => void;
  onToolTrace?: (trace: ToolExecutionTrace) => void;
}

/**
 * Streaming version of Ann turn for ultra-fast perceived latency over SSE.
 */
export async function runAnnAgentTurnStream(
  input: ChatTurnInput,
  callbacks: StreamCallbacks
): Promise<AgentTurnResponse> {
  const ai = getGeminiClient();
  const state: {
    currentMemory: UserLifestyleMemory;
    structuredSchedule: StructuredSchedulePlan | null;
    memoryConsentRequest: MemoryConsentRequest | null;
  } = {
    currentMemory: input.memory
      ? { ...input.memory }
      : { ...DEFAULT_USER_LIFESTYLE_MEMORY },
    structuredSchedule: null,
    memoryConsentRequest: null,
  };

  const systemInstruction = buildAnnRuntimeSystemInstructions(state.currentMemory);

  const contents: Content[] = [
    ...input.history.map((msg) => ({
      role: msg.role,
      parts: [{ text: msg.text }],
    })),
    {
      role: 'user',
      parts: [{ text: input.userMessage }],
    },
  ];

  const toolTrace: ToolExecutionTrace[] = [];
  const maxToolRounds = 4;
  let fullReplyText = '';

  for (let round = 0; round < maxToolRounds; round++) {
    const stream = await withRetry(() =>
      ai.models.generateContentStream({
        model: MODEL_NAME,
        contents,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          tools: [{ functionDeclarations: ANN_FUNCTION_DECLARATIONS }],
        },
      })
    );

    const collectedParts: Part[] = [];
    const collectedFunctionCalls: Array<{
      id?: string;
      name?: string;
      args?: Record<string, unknown>;
    }> = [];

    for await (const chunk of stream) {
      const chunkText = chunk.text;
      if (chunkText) {
        fullReplyText += chunkText;
        callbacks.onTextDelta(chunkText);
      }

      const parts = chunk.candidates?.[0]?.content?.parts;
      if (parts) {
        for (const p of parts) {
          collectedParts.push(p);
        }
      }

      if (chunk.functionCalls && chunk.functionCalls.length > 0) {
        for (const fc of chunk.functionCalls) {
          collectedFunctionCalls.push({
            id: fc.id,
            name: fc.name,
            args: fc.args as Record<string, unknown> | undefined,
          });
        }
      }
    }

    if (collectedFunctionCalls.length === 0) {
      break;
    }

    contents.push({
      role: 'model',
      parts: collectedParts,
    });

    const functionResponseParts: Part[] = [];
    for (const call of collectedFunctionCalls) {
      const args = call.args ?? {};
      const toolName = call.name ?? 'unknown';
      const toolResult = executeAnnToolCall(toolName, args, state);
      const traceEntry = { toolName, args, result: toolResult };

      toolTrace.push(traceEntry);
      callbacks.onToolTrace?.(traceEntry);

      functionResponseParts.push({
        functionResponse: {
          id: call.id,
          name: toolName,
          response: toolResult,
        },
      });
    }

    contents.push({
      role: 'user',
      parts: functionResponseParts,
    });

    if (state.structuredSchedule && !fullReplyText.trim()) {
      const formatted = formatScheduleAsMarkdown(state.structuredSchedule);
      fullReplyText = formatted;
      callbacks.onTextDelta(formatted);
      break;
    }
  }

  let trimmedReply = fullReplyText.trim();
  if (!trimmedReply && state.structuredSchedule) {
    trimmedReply = formatScheduleAsMarkdown(state.structuredSchedule);
    callbacks.onTextDelta(trimmedReply);
  }

  return {
    replyText: sanitizeAnnReply(trimmedReply),
    structuredSchedule: state.structuredSchedule,
    memoryConsentRequest: state.memoryConsentRequest,
    updatedMemory: state.currentMemory,
    toolTrace,
  };
}

export async function runQualityTestById(testId: number): Promise<QualityTestResult> {
  const testCase = QUALITY_TEST_CASES.find((t) => t.id === testId);
  if (!testCase) {
    throw new Error(`Quality test #${testId} not found.`);
  }
  return evaluateQualityTestCase(testCase);
}

export async function evaluateQualityTestCase(
  testCase: QualityTestCase
): Promise<QualityTestResult> {
  const agentTurn = await runAnnAgentTurn({
    history: [],
    userMessage: testCase.questionAr,
    memory: DEFAULT_USER_LIFESTYLE_MEMORY,
  });

  const ai = getGeminiClient();
  const evaluationPrompt = `أنت مقيّم جودة صارم لوكيل الذكاء الاصطناعي «آن | Ann» المتخصص في تنظيم الوقت.
قيّم إجابة المساعد التالية بناءً على المعايير المحددة والمحظورات:

السؤال الاختباري:
"${testCase.questionAr}"

مجال التركيز:
${testCase.focusAreaAr}

معايير القبول المطلوبة:
${testCase.evaluationCriteriaAr.map((c, i) => `${i + 1}. ${c}`).join('\n')}

محظورات لا يجوز فعلها:
${testCase.mustNotDoAr.map((m, i) => `${i + 1}. ${m}`).join('\n')}

إجابة المساعد «آن | Ann»:
"""
${agentTurn.replyText}
"""

أرجع تقييمًا موضوعيًا دقيقًا باللغة العربية بصيغة JSON.`;

  const evalResponse = await withRetry(() =>
    ai.models.generateContent({
      model: MODEL_NAME,
      contents: evaluationPrompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            passed: { type: Type.BOOLEAN },
            score: {
              type: Type.INTEGER,
              description: 'Score from 0 to 100',
            },
            checks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  criterion: { type: Type.STRING },
                  passed: { type: Type.BOOLEAN },
                  note: { type: Type.STRING },
                },
                required: ['criterion', 'passed', 'note'],
              },
            },
            summaryNote: { type: Type.STRING },
          },
          required: ['passed', 'score', 'checks', 'summaryNote'],
        },
      },
    })
  );

  const parsed = JSON.parse((evalResponse.text ?? '{}').trim()) as {
    passed: boolean;
    score: number;
    checks: { criterion: string; passed: boolean; note: string }[];
    summaryNote: string;
  };

  return {
    testId: testCase.id,
    questionAr: testCase.questionAr,
    agentReplyAr: agentTurn.replyText,
    toolTrace: agentTurn.toolTrace,
    passed: Boolean(parsed.passed),
    score: Number(parsed.score ?? 0),
    checks: Array.isArray(parsed.checks) ? parsed.checks : [],
    summaryNote: parsed.summaryNote ?? '',
  };
}
