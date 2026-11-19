import type { UserLifestyleMemory } from './types.ts';

export const DEFAULT_USER_LIFESTYLE_MEMORY: UserLifestyleMemory = {
  consentGranted: false,
  dayTiming: {},
  studyAndWork: {},
  physicalActivity: {},
  personalLife: {},
  goals: {},
};

/**
 * مواصفات الذاكرة والتخصيص التدريجي (تُستخدم عند دعم المنصة للذاكرة وبموافقة المستخدم فقط)
 */
export const MEMORY_SPECIFICATION = {
  policySummaryAr:
    'يتعلم «آن | Ann» نمط حياة المستخدم تدريجيًا عبر المحادثات، ولا يطلب كل المعلومات دفعة واحدة بل يسأل عنها عند الحاجة الفعلية للتخطيط فقط. وفق المبدأ رقم (11)، يُمنع حفظ أي بيانات شخصية في الذاكرة الدائمة دون موافقة صريحة من المستخدم.',
  consentRuleAr:
    'عند اكتشاف معلومات نمط حياة مفيدة للمستقبل (مثل موعد الاستيقاظ المعتاد، أيام الجيم، ساعات التركيز الأعلى، أو الالتزامات الثابتة)، يطلب آن إذنًا واضحًا ومختصرًا من المستخدم قبل حفظها، أو يستخدم أداة request_or_update_memory.',
  dimensions: [
    {
      id: 'dayTiming',
      titleAr: 'مواعيد اليوم',
      fields: [
        { key: 'wakeUpTime', labelAr: 'موعد الاستيقاظ المعتاد' },
        { key: 'sleepTime', labelAr: 'موعد النوم المعتاد' },
        { key: 'actualDayStart', labelAr: 'وقت بداية اليوم الفعلي' },
        { key: 'peakFocusWindows', labelAr: 'أوقات التركيز المرتفعة' },
        { key: 'lowEnergyWindows', labelAr: 'أوقات انخفاض الطاقة' },
      ],
    },
    {
      id: 'studyAndWork',
      titleAr: 'الدراسة والعمل',
      fields: [
        { key: 'nature', labelAr: 'طبيعة الدراسة أو العمل' },
        { key: 'fixedCommitments', labelAr: 'المواعيد الثابتة المتكررة' },
        { key: 'subjectsOrTasks', labelAr: 'المواد أو المهام الرئيسية' },
        { key: 'upcomingDeadlines', labelAr: 'مواعيد الامتحانات والتسليمات' },
        { key: 'averageTaskDurations', labelAr: 'متوسط مدة إنجاز المهام' },
      ],
    },
    {
      id: 'physicalActivity',
      titleAr: 'النشاط البدني',
      fields: [
        { key: 'gymDaysPerWeek', labelAr: 'عدد أيام الجيم أسبوعيًا' },
        { key: 'workoutDays', labelAr: 'أيام التمرين المحددة' },
        { key: 'workoutDurationMinutes', labelAr: 'مدة التمرين بالدقائق' },
        { key: 'otherMovementActivities', labelAr: 'أنشطة الحركة في الأيام الأخرى (مثل المشي)' },
        { key: 'recoveryDays', labelAr: 'أيام الراحة والتعافي' },
      ],
    },
    {
      id: 'personalLife',
      titleAr: 'الحياة الشخصية',
      fields: [
        { key: 'householdResponsibilities', labelAr: 'المسؤوليات المنزلية' },
        { key: 'errands', labelAr: 'المشاوير المتكررة' },
        { key: 'socialCommitments', labelAr: 'الالتزامات الاجتماعية والعائلية' },
        { key: 'hobbies', labelAr: 'الهوايات والترفيه' },
        { key: 'personalTimeNotes', labelAr: 'ملاحظات الوقت الشخصي' },
      ],
    },
    {
      id: 'goals',
      titleAr: 'الأهداف',
      fields: [
        { key: 'dailyGoals', labelAr: 'الأهداف اليومية' },
        { key: 'weeklyGoals', labelAr: 'الأهداف الأسبوعية' },
        { key: 'monthlyGoals', labelAr: 'الأهداف الشهرية' },
        { key: 'skillsToLearn', labelAr: 'المهارات المطلوب تعلمها' },
        { key: 'habitsToBuild', labelAr: 'العادات المطلوب بناؤها' },
      ],
    },
  ],
} as const;

export function mergeConsentedMemory(
  current: UserLifestyleMemory,
  patch: Partial<UserLifestyleMemory>
): UserLifestyleMemory {
  if (!current.consentGranted && patch.consentGranted !== true) {
    return current;
  }

  return {
    consentGranted: patch.consentGranted ?? current.consentGranted,
    consentUpdatedAt: patch.consentGranted
      ? new Date().toISOString()
      : current.consentUpdatedAt,
    dayTiming: { ...current.dayTiming, ...(patch.dayTiming ?? {}) },
    studyAndWork: { ...current.studyAndWork, ...(patch.studyAndWork ?? {}) },
    physicalActivity: { ...current.physicalActivity, ...(patch.physicalActivity ?? {}) },
    personalLife: { ...current.personalLife, ...(patch.personalLife ?? {}) },
    goals: { ...current.goals, ...(patch.goals ?? {}) },
  };
}

export function formatMemoryForPrompt(memory?: UserLifestyleMemory): string {
  if (!memory || !memory.consentGranted) {
    return 'لا توجد ذاكرة محفوظة مسبقًا (لم يمنح المستخدم موافقة حفظ البيانات بعد). لا تحفظ أي بيانات شخصية دون موافقة صريحة من المستخدم.';
  }

  const sections: string[] = [];
  if (Object.keys(memory.dayTiming).length > 0) {
    sections.push(`- مواعيد اليوم: ${JSON.stringify(memory.dayTiming)}`);
  }
  if (Object.keys(memory.studyAndWork).length > 0) {
    sections.push(`- الدراسة والعمل: ${JSON.stringify(memory.studyAndWork)}`);
  }
  if (Object.keys(memory.physicalActivity).length > 0) {
    sections.push(`- النشاط البدني: ${JSON.stringify(memory.physicalActivity)}`);
  }
  if (Object.keys(memory.personalLife).length > 0) {
    sections.push(`- الحياة الشخصية: ${JSON.stringify(memory.personalLife)}`);
  }
  if (Object.keys(memory.goals).length > 0) {
    sections.push(`- الأهداف: ${JSON.stringify(memory.goals)}`);
  }

  if (sections.length === 0) {
    return 'المستخدم وافق على استخدام الذاكرة، لكن لم تُسجل تفضيلات نمط حياة بعد. اجمعها تدريجيًا عند الحاجة فقط.';
  }

  return `بيانات نمط حياة المستخدم المحفوظة بموافقته:\n${sections.join('\n')}`;
}
