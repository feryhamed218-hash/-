import { ANN_FUNCTION_DECLARATIONS } from './decisionRules.ts';
import {
  BASIC_BASELINE_DISTRIBUTION,
  KNOWLEDGE_BASE,
  NON_NEGOTIABLE_PRINCIPLES,
  SIX_CORE_CATEGORIES,
  THINKING_STEPS,
} from './knowledgeBase.ts';
import { DEFAULT_USER_LIFESTYLE_MEMORY, MEMORY_SPECIFICATION } from './memoryConfig.ts';
import { QUALITY_TEST_CASES } from './qualityTests.ts';
import { TRAINING_SCENARIOS } from './scenarios.ts';
import { ANN_IDENTITY, CONVERSATION_STARTERS, WELCOME_MESSAGE } from './starters.ts';
import { buildAnnSystemInstructions } from './systemInstructions.ts';

export const CIRCULAR_CLOCK_SCHEDULE_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'AnnCircularClockSchedulePlan',
  description:
    'تنسيق JSON القياسي لمخرجات آن | Ann للربط المباشر مع منصة تنظيم الوقت والساعة الدائرية التفاعلية.',
  type: 'object',
  required: [
    'planTitle',
    'dayStart',
    'dayEnd',
    'activities',
    'topThreePriorities',
    'restPeriods',
    'flexibleTimeSummary',
    'distributionRationale',
    'postponableTasks',
    'isRealistic',
  ],
  properties: {
    planTitle: { type: 'string' },
    dayStart: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
    dayEnd: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
    activities: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'activityName',
          'startTime',
          'endTime',
          'category',
          'categoryLabelAr',
          'priority',
          'completionStatus',
        ],
        properties: {
          activityName: { type: 'string', description: 'اسم النشاط' },
          startTime: { type: 'string', description: 'وقت البداية HH:mm' },
          endTime: { type: 'string', description: 'وقت النهاية HH:mm' },
          category: {
            type: 'string',
            enum: [
              'WORK_OR_STUDY',
              'PHYSICAL_ACTIVITY',
              'DAILY_TASKS',
              'LEARNING_AND_GROWTH',
              'FLEXIBLE_TIME',
              'REST',
            ],
          },
          categoryLabelAr: {
            type: 'string',
            enum: [
              'العمل أو الدراسة',
              'النشاط البدني',
              'المهام اليومية',
              'التعلم والإنجاز الإضافي',
              'الوقت المرن',
              'الراحة',
            ],
          },
          priority: { type: 'string', enum: ['عالية', 'متوسطة', 'منخفضة'] },
          completionStatus: {
            type: 'string',
            enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'POSTPONED'],
          },
          optionalNotes: { type: 'string' },
        },
      },
    },
    topThreePriorities: { type: 'array', items: { type: 'string' } },
    restPeriods: { type: 'array', items: { type: 'string' } },
    flexibleTimeSummary: { type: 'string' },
    distributionRationale: { type: 'string' },
    postponableTasks: { type: 'array', items: { type: 'string' } },
    conflictsOrWarnings: { type: 'array', items: { type: 'string' } },
    isRealistic: { type: 'boolean' },
  },
};

export function getFullAgentBlueprint() {
  return {
    agentVersion: '1.0.0',
    identity: ANN_IDENTITY,
    welcomeMessage: WELCOME_MESSAGE,
    conversationStarters: CONVERSATION_STARTERS,
    systemInstructions: buildAnnSystemInstructions(DEFAULT_USER_LIFESTYLE_MEMORY),
    basicBaselineDistribution: BASIC_BASELINE_DISTRIBUTION,
    sixCoreCategories: SIX_CORE_CATEGORIES,
    knowledgeBase: KNOWLEDGE_BASE,
    thinkingSteps: THINKING_STEPS,
    nonNegotiablePrinciples: NON_NEGOTIABLE_PRINCIPLES,
    functionTools: ANN_FUNCTION_DECLARATIONS,
    scheduleJsonSchema: CIRCULAR_CLOCK_SCHEDULE_JSON_SCHEMA,
    memorySpecification: MEMORY_SPECIFICATION,
    defaultMemoryState: DEFAULT_USER_LIFESTYLE_MEMORY,
    trainingScenarios: TRAINING_SCENARIOS,
    qualityTests: QUALITY_TEST_CASES,
  };
}
