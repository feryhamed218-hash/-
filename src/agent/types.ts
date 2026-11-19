export type ScheduleCategoryId =
  | 'WORK_OR_STUDY'
  | 'PHYSICAL_ACTIVITY'
  | 'DAILY_TASKS'
  | 'LEARNING_AND_GROWTH'
  | 'FLEXIBLE_TIME'
  | 'REST';

export type PriorityLevel = 'عالية' | 'متوسطة' | 'منخفضة';

export type CompletionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'POSTPONED';

export interface CategoryDefinition {
  id: ScheduleCategoryId;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  reasonAr: string;
  examplesAr: string[];
  ambiguousOverlapHintsAr: string;
}

export interface StructuredActivity {
  activityName: string;
  startTime: string; // HH:mm (24h)
  endTime: string;   // HH:mm (24h)
  category: ScheduleCategoryId;
  categoryLabelAr: string;
  priority: PriorityLevel;
  completionStatus: CompletionStatus;
  optionalNotes?: string;
}

export interface StructuredSchedulePlan {
  planTitle: string;
  dayStart: string; // HH:mm
  dayEnd: string;   // HH:mm
  activities: StructuredActivity[];
  topThreePriorities: string[];
  restPeriods: string[];
  flexibleTimeSummary: string;
  distributionRationale: string;
  postponableTasks: string[];
  conflictsOrWarnings: string[];
  isRealistic: boolean;
}

export interface KnowledgeDomain {
  id: string;
  titleAr: string;
  titleEn: string;
  rulesAr: string[];
  decisionTriggersAr: string[];
}

export interface TrainingScenario {
  id: string;
  titleAr: string;
  userMessage: string;
  agentReasoningChecklistAr: string[];
  idealResponseAr: string;
  expectedStructuredOutput?: Partial<StructuredSchedulePlan>;
}

export interface UserLifestyleMemory {
  consentGranted: boolean;
  consentUpdatedAt?: string;
  dayTiming: {
    wakeUpTime?: string;
    sleepTime?: string;
    actualDayStart?: string;
    peakFocusWindows?: string[];
    lowEnergyWindows?: string[];
  };
  studyAndWork: {
    nature?: string;
    fixedCommitments?: string[];
    subjectsOrTasks?: string[];
    upcomingDeadlines?: string[];
    averageTaskDurations?: Record<string, string>;
  };
  physicalActivity: {
    gymDaysPerWeek?: number;
    workoutDays?: string[];
    workoutDurationMinutes?: number;
    otherMovementActivities?: string[];
    recoveryDays?: string[];
  };
  personalLife: {
    householdResponsibilities?: string[];
    errands?: string[];
    socialCommitments?: string[];
    hobbies?: string[];
    personalTimeNotes?: string;
  };
  goals: {
    dailyGoals?: string[];
    weeklyGoals?: string[];
    monthlyGoals?: string[];
    skillsToLearn?: string[];
    habitsToBuild?: string[];
  };
}

export interface MemoryConsentRequest {
  requested: boolean;
  proposedFieldsSummaryAr: string[];
  reasonAr: string;
}

export interface ToolExecutionTrace {
  toolName: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface AgentTurnResponse {
  replyText: string;
  structuredSchedule: StructuredSchedulePlan | null;
  memoryConsentRequest: MemoryConsentRequest | null;
  updatedMemory: UserLifestyleMemory;
  toolTrace: ToolExecutionTrace[];
}

export interface QualityTestCase {
  id: number;
  questionAr: string;
  focusAreaAr: string;
  evaluationCriteriaAr: string[];
  mustNotDoAr: string[];
}

export interface QualityTestResult {
  testId: number;
  questionAr: string;
  agentReplyAr: string;
  toolTrace: ToolExecutionTrace[];
  passed: boolean;
  score: number;
  checks: {
    criterion: string;
    passed: boolean;
    note: string;
  }[];
  summaryNote: string;
}
