import { Type, type FunctionDeclaration } from '@google/genai';
import { SIX_CORE_CATEGORIES } from './knowledgeBase.ts';
import type {
  PriorityLevel,
  ScheduleCategoryId,
  StructuredActivity,
  StructuredSchedulePlan,
} from './types.ts';

const CATEGORY_MAP = new Map(SIX_CORE_CATEGORIES.map((c) => [c.id, c]));

export function timeToMinutes(hhmm: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

export function validateSchedulePlan(plan: StructuredSchedulePlan): {
  valid: boolean;
  conflicts: string[];
  warnings: string[];
  normalizedPlan: StructuredSchedulePlan;
} {
  const conflicts: string[] = [];
  const warnings: string[] = [];

  const normalizedActivities: StructuredActivity[] = (plan.activities ?? []).map((act) => {
    const catDef = CATEGORY_MAP.get(act.category);
    return {
      ...act,
      categoryLabelAr: catDef ? catDef.nameAr : act.categoryLabelAr || 'العمل أو الدراسة',
      completionStatus: act.completionStatus || 'PENDING',
    };
  });

  // Sort by start time for overlap detection
  const withMinutes = normalizedActivities
    .map((act) => ({
      act,
      start: timeToMinutes(act.startTime),
      end: timeToMinutes(act.endTime),
    }))
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

  for (let i = 0; i < withMinutes.length; i++) {
    const cur = withMinutes[i];
    if (cur.start === null || cur.end === null) {
      warnings.push(`صيغة الوقت غير قياسية في نشاط: ${cur.act.activityName}`);
      continue;
    }
    if (cur.end <= cur.start && !(cur.end < 360 && cur.start >= 1200)) {
      conflicts.push(`وقت النهاية قبل أو يساوي وقت البداية في: ${cur.act.activityName}`);
    }
    if (i > 0) {
      const prev = withMinutes[i - 1];
      if (prev.end !== null && cur.start < prev.end) {
        conflicts.push(
          `تداخل زمني بين "${prev.act.activityName}" (${prev.act.startTime}-${prev.act.endTime}) و "${cur.act.activityName}" (${cur.act.startTime}-${cur.act.endTime})`
        );
      }
    }
  }

  const hasRest = normalizedActivities.some((a) => a.category === 'REST');
  if (!hasRest && normalizedActivities.length >= 4) {
    warnings.push('الجدول لا يحتوي على فترة راحة أو استرخاء واضحة (قسم الراحة).');
  }

  const hasFlexible = normalizedActivities.some((a) => a.category === 'FLEXIBLE_TIME');
  if (!hasFlexible && normalizedActivities.length >= 5) {
    warnings.push('الجدول مزدحم بدون وقت مرن أو مساحة شخصية للتنفس.');
  }

  const gymWithoutNote = normalizedActivities.find(
    (a) =>
      a.category === 'PHYSICAL_ACTIVITY' &&
      (a.activityName.includes('جيم') || a.activityName.toLowerCase().includes('gym')) &&
      !(a.optionalNotes?.includes('انتقال') || a.optionalNotes?.includes('مواصلات') || a.optionalNotes?.includes('تجهيز') || a.optionalNotes?.includes('استحمام'))
  );
  if (gymWithoutNote) {
    warnings.push('تأكد من احتساب وقت الانتقال والتجهيز والاستحمام مع نشاط الجيم.');
  }

  const isRealistic = conflicts.length === 0 && (plan.isRealistic ?? true);

  return {
    valid: conflicts.length === 0,
    conflicts,
    warnings,
    normalizedPlan: {
      ...plan,
      activities: normalizedActivities,
      conflictsOrWarnings: Array.from(
        new Set([...(plan.conflictsOrWarnings ?? []), ...conflicts, ...warnings])
      ),
      isRealistic,
    },
  };
}

/**
 * أدوات Function Calling الخاصة بآن | Ann للتكامل المنظم مع المنصة والساعة الدائرية
 */
export const ANN_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'classify_activity',
    description:
      'تصنيف أي نشاط يذكره المستخدم ضمن الأقسام الستة الأساسية الثابتة للساعة الدائرية، مع اقتراح تصنيف بديل إذا كان النشاط يحتمل أكثر من قسم.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        activityName: {
          type: Type.STRING,
          description: 'اسم النشاط كما ذكره المستخدم',
        },
        primaryCategory: {
          type: Type.STRING,
          enum: [
            'WORK_OR_STUDY',
            'PHYSICAL_ACTIVITY',
            'DAILY_TASKS',
            'LEARNING_AND_GROWTH',
            'FLEXIBLE_TIME',
            'REST',
          ],
          description: 'القسم الأساسي الأنسب',
        },
        alternativeCategory: {
          type: Type.STRING,
          enum: [
            'WORK_OR_STUDY',
            'PHYSICAL_ACTIVITY',
            'DAILY_TASKS',
            'LEARNING_AND_GROWTH',
            'FLEXIBLE_TIME',
            'REST',
          ],
          description: 'تصنيف بديل مقترح إذا كان النشاط يحتمل أكثر من قسم',
        },
        reasonAr: {
          type: Type.STRING,
          description: 'سبب اختيار هذا التصنيف باختصار',
        },
      },
      required: ['activityName', 'primaryCategory', 'reasonAr'],
    },
  },
  {
    name: 'publish_structured_schedule',
    description:
      'نشر واعتماد الجدول اليومي المنظم بصيغة JSON جاهزة للساعة الدائرية التفاعلية بعد التأكد من اكتمال المعلومات وعدم وجود تعارضات زمنية.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        planTitle: { type: Type.STRING, description: 'عنوان مختصر للخطة اليومية' },
        dayStart: { type: Type.STRING, description: 'وقت بداية اليوم الفعلي بصيغة HH:mm' },
        dayEnd: { type: Type.STRING, description: 'وقت نهاية اليوم الفعلي بصيغة HH:mm' },
        activities: {
          type: Type.ARRAY,
          description: 'قائمة الأنشطة المرتبة زمنيًا',
          items: {
            type: Type.OBJECT,
            properties: {
              activityName: { type: Type.STRING },
              startTime: { type: Type.STRING, description: 'HH:mm' },
              endTime: { type: Type.STRING, description: 'HH:mm' },
              category: {
                type: Type.STRING,
                enum: [
                  'WORK_OR_STUDY',
                  'PHYSICAL_ACTIVITY',
                  'DAILY_TASKS',
                  'LEARNING_AND_GROWTH',
                  'FLEXIBLE_TIME',
                  'REST',
                ],
              },
              priority: {
                type: Type.STRING,
                enum: ['عالية', 'متوسطة', 'منخفضة'],
              },
              completionStatus: {
                type: Type.STRING,
                enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'POSTPONED'],
              },
              optionalNotes: { type: Type.STRING },
            },
            required: ['activityName', 'startTime', 'endTime', 'category', 'priority', 'completionStatus'],
          },
        },
        topThreePriorities: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'أهم ثلاث أولويات في اليوم',
        },
        restPeriods: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'فترات الراحة والاستراحة والنوم الموزعة',
        },
        flexibleTimeSummary: {
          type: Type.STRING,
          description: 'ملخص الوقت المرن والمساحة الشخصية',
        },
        distributionRationale: {
          type: Type.STRING,
          description: 'سبب توزيع المهام بهذا الشكل',
        },
        postponableTasks: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'المهام القابلة للتأجيل أو إعادة الجدولة عند ضيق الوقت',
        },
        isRealistic: {
          type: Type.BOOLEAN,
          description: 'هل الوقت المتاح يكفي فعليًا لإنجاز الأنشطة بدون إرهاق؟',
        },
      },
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
    },
  },
  {
    name: 'request_or_update_memory',
    description:
      'طلب موافقة المستخدم على حفظ تفضيلات نمط حياته، أو حفظها فقط إذا كان المستخدم قد منح الموافقة بالفعل.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          enum: ['REQUEST_CONSENT', 'SAVE_WITH_CONSENT'],
          description: 'اطلب الموافقة أولًا إذا لم تكن ممنوحة، أو احفظ فقط بعد موافقة صريحة.',
        },
        proposedFieldsSummaryAr: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'ملخص النقاط التي نرغب في حفظها عن نمط حياة المستخدم',
        },
        reasonAr: {
          type: Type.STRING,
          description: 'فائدة حفظ هذه المعلومة لتسهيل التنظيم مستقبلًا',
        },
        wakeUpTime: { type: Type.STRING },
        sleepTime: { type: Type.STRING },
        actualDayStart: { type: Type.STRING },
        peakFocusWindows: { type: Type.ARRAY, items: { type: Type.STRING } },
        gymDaysPerWeek: { type: Type.NUMBER },
        workoutDays: { type: Type.ARRAY, items: { type: Type.STRING } },
        fixedCommitments: { type: Type.ARRAY, items: { type: Type.STRING } },
        skillsToLearn: { type: Type.ARRAY, items: { type: Type.STRING } },
        habitsToBuild: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['action', 'proposedFieldsSummaryAr', 'reasonAr'],
    },
  },
];

export function formatScheduleCategoryLabel(category: ScheduleCategoryId): string {
  return CATEGORY_MAP.get(category)?.nameAr ?? category;
}

export function normalizePriority(val: string): PriorityLevel {
  if (val === 'عالية' || val === 'متوسطة' || val === 'منخفضة') return val;
  return 'متوسطة';
}

export function formatScheduleAsMarkdown(plan: StructuredSchedulePlan): string {
  const rows = plan.activities
    .map(
      (a) =>
        `| ${a.startTime} - ${a.endTime} | ${a.activityName} | ${a.categoryLabelAr} | ${a.priority} |`
    )
    .join('\n');

  const priorities = (plan.topThreePriorities ?? [])
    .map((p, i) => `${i + 1}. ${p}`)
    .join('\n');

  const rest = (plan.restPeriods ?? []).join('، ') || 'موزعة ضمن الجدول';
  const postponable =
    plan.postponableTasks && plan.postponableTasks.length > 0
      ? plan.postponableTasks.join('، ')
      : 'لا يوجد حاليًا';

  return `دي التوزيعة المقترحة ليومك من ${plan.dayStart} إلى ${plan.dayEnd} بناءً على التقسيمة الأساسية ومعدلة حسب تفاصيلك:
| الوقت | النشاط | القسم | الأولوية |
| :--- | :--- | :--- | :--- |
${rows}
أهم ثلاث أولويات:
${priorities}
فترات الراحة: ${rest}
الوقت المرن: ${plan.flexibleTimeSummary}
سبب التوزيع: ${plan.distributionRationale}
المهام القابلة للتأجيل: ${postponable}
لو تحب نعدل أي ميعاد أو نزود أو نقلل حاجة، قولي وأظبطهولك فورًا.`;
}
