import { CandidateSession } from '../types';

export const initialCandidateSessions: CandidateSession[] = [
  {
    candidateId: 'IG-623018',
    candidateName: 'David Al-Mansoor',
    candidatePhotoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
    examId: 'exam-ielts-academic-101',
    examTitle: 'IELTS Academic Practice Test 1 (Full Simulation)',
    createdAt: '2026-09-06T09:15:00Z',
    status: 'finalized',
    currentSection: 'completed',
    trfNumber: '26GB01428623018001A',
    lockStatus: {
      violations: 0,
      isLocked: false,
      lockHistory: []
    },
    listeningState: {
      bufferedPercent: 100,
      audioPlayed: true,
      reviewTimerRemaining: 0,
      answers: {
        'l-q1': 'Sarah',
        'l-q2': 'Meadow Lane',
        'l-q3': 'B',
        'l-q4': 'Antique Clock Gallery',
        'l-q5': 'Botanical Nursery',
        'l-q6': 'B',
        'l-q7': 'biochar',
        'l-q8': 'heat sinks'
      },
      highlights: [],
      completed: true
    },
    readingState: {
      timeRemainingSeconds: 0,
      answers: {
        'r-q1': 'TRUE',
        'r-q2': 'calfskin vellum',
        'r-q3': 'B',
        'r-q4': 'rhoxodrome',
        'r-q5': 'B',
        'r-q6': 'esca',
        'r-q7': 'counterillumination',
        'r-q8': 'NOT GIVEN'
      },
      highlights: [
        {
          id: 'hl-1',
          passageId: 'read-pass-1',
          text: 'portolan charts were crisscrossed with rhumb lines',
          color: 'yellow',
          timestamp: '2026-09-06T10:12:00Z'
        },
        {
          id: 'hl-2',
          passageId: 'read-pass-2',
          text: 'counterillumination',
          color: 'green',
          timestamp: '2026-09-06T10:35:00Z'
        }
      ],
      completed: true
    },
    writingState: {
      timeRemainingSeconds: 0,
      task1Response: `The comparative bar chart demonstrates international capital expenditure on renewable energy sub-sectors across four key territories between 2010 and 2025. 

Overall, global clean technology financing surged dramatically over the fifteen-year timeframe, rising from $140 billion to $580 billion. Solar photovoltaic installations and onshore/offshore wind generation attracted the preeminent share of investment, with the Asia-Pacific region emerging as the primary financial driver.

In 2010, Europe was the leading investor with $55 billion in solar infrastructure, whereas Asia-Pacific accounted for $42 billion. However, by 2025, Asia-Pacific expanded its solar investments significantly to $185 billion, vastly outstripping North America at $88 billion. Wind power followed a parallel upward trajectory: European wind allocations reached $110 billion by 2025, while Asia-Pacific commanded $130 billion. Hydroelectric and bio-energy witnessed steady, moderate increases across all surveyed territories.`,
      task2Response: `In contemporary governance, algorithmic automation and predictive computation are increasingly utilized to optimize urban logistics, judicial risk assessment, and bureaucratic allocation. While proponents argue that machine objectivity reduces systemic human prejudice and operational latency, I contend that critical societal judgments require human ethical empathy and discretionary accountability.

On the one hand, computational algorithms offer undeniable advantages in data processing throughput. In traffic coordination and electrical grid load balancing, automated models can synthesize millions of telemetry data points per second, mitigating human error and drastically trimming public expenditure. Furthermore, advocates suggest that algorithmic recidivism risk assessment could theoretically eliminate subconscious racial or socioeconomic biases held by human magistrates.

On the other hand, relying exclusively on automated systems within judicial sentencing or welfare distribution entails grave hazards. Algorithms are inherently trained on historical training corpora that often mirror historical institutional discrimination. When an algorithm codifies these statistical disparities, it inadvertently perpetuates them under the guise of mathematical neutrality. More fundamentally, machines lack contextual intuition and moral remorse; a machine cannot comprehend compassion, unique mitigating life circumstances, or human dignity.

In conclusion, while predictive analytics serve as a powerful auxiliary instrument for municipal efficiency, final sovereign authority in legal adjudication and public welfare must undeniably remain anchored in human conscience.`,
      completed: true
    },
    grading: {
      listeningScore: {
        raw: 8,
        band: 8.5,
        total: 8
      },
      readingScore: {
        raw: 8,
        band: 9.0,
        total: 8
      },
      writingAiEvaluation: {
        task1Band: { ta_tr: 8.0, cc: 7.5, lr: 8.0, gra: 8.0, overall: 8.0 },
        task2Band: { ta_tr: 7.5, cc: 8.0, lr: 8.0, gra: 7.5, overall: 8.0 },
        overallBand: 8.0,
        errors: [],
        feedbackSummary: 'Exemplary essay with sophisticated lexical choices and cohesive structure.',
        criteriaFeedback: {
          ta_tr: 'Both tasks address all prompt parts comprehensively with well-supported arguments.',
          cc: 'Smooth logical progression with natural paragraphing and varied linking devices.',
          lr: 'Sophisticated academic vocabulary (e.g., "telemetry", "recidivism", "codifies").',
          gra: 'Wide range of complex syntactic structures with high accuracy.'
        },
        evaluatedAt: '2026-09-06T11:45:00Z'
      },
      writingAdminEvaluation: {
        task1Band: { ta_tr: 8.0, cc: 8.0, lr: 8.0, gra: 8.0, overall: 8.0 },
        task2Band: { ta_tr: 7.5, cc: 8.0, lr: 8.0, gra: 7.5, overall: 7.5 },
        overallBand: 8.0,
        comments: [
          {
            id: 'c-1',
            task: 1,
            selectedText: 'surged dramatically over the fifteen-year timeframe',
            note: 'Strong, accurate lexical selection here.',
            author: 'Chief Examiner Dr. H. Reynolds',
            createdAt: '2026-09-06T12:05:00Z'
          },
          {
            id: 'c-2',
            task: 2,
            selectedText: 'mitigating human error and drastically trimming public expenditure',
            note: 'Well-framed argumentation and grammatical precision.',
            author: 'Chief Examiner Dr. H. Reynolds',
            createdAt: '2026-09-06T12:10:00Z'
          }
        ],
        adminFeedback: 'Superb command of academic English. Writing Task 1 summary was precise; Task 2 demonstrated balanced argumentation with mature perspective.',
        isFinalized: true,
        finalizedAt: '2026-09-06T12:15:00Z',
        finalizedBy: 'Dr. H. Reynolds (Center #GB120)'
      },
      speakingEvaluation: {
        fluency: 8.0,
        lexical: 8.5,
        grammar: 8.0,
        pronunciation: 8.0,
        overallBand: 8.0,
        examinerNotes: 'Candidate spoke with effortless spontaneity and nuance. Idiomatic expressions used naturally. Phonological features were crisp with appropriate sentence stress.',
        evaluatedAt: '2026-09-06T12:20:00Z'
      },
      finalOverallBand: 8.5, // (8.5 + 9.0 + 8.0 + 8.0) / 4 = 8.375 -> rounds to 8.5!
      cefrLevel: 'C2',
      isFinalized: true,
      finalizedAt: '2026-09-06T12:25:00Z'
    },
    lastSavedAt: '2026-09-06T12:25:00Z'
  },
  {
    candidateId: 'IG-894215',
    candidateName: 'Elena Rostova',
    candidatePhotoUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&auto=format&fit=crop&q=80',
    examId: 'exam-ielts-academic-101',
    examTitle: 'IELTS Academic Practice Test 1 (Full Simulation)',
    createdAt: '2026-09-07T11:00:00Z',
    status: 'completed',
    currentSection: 'completed',
    trfNumber: '26GB01428894215002B',
    lockStatus: {
      violations: 0,
      isLocked: false,
      lockHistory: []
    },
    listeningState: {
      bufferedPercent: 100,
      audioPlayed: true,
      reviewTimerRemaining: 0,
      answers: {
        'l-q1': 'Sarah',
        'l-q2': 'Meadow',
        'l-q3': 'B',
        'l-q4': 'Clock Gallery',
        'l-q5': 'Botanical Nursery',
        'l-q6': 'Decreased nitrogen runoff by nearly 40%',
        'l-q7': 'biochar',
        'l-q8': 'heat sink'
      },
      highlights: [],
      completed: true
    },
    readingState: {
      timeRemainingSeconds: 0,
      answers: {
        'r-q1': 'TRUE',
        'r-q2': 'vellum',
        'r-q3': 'They were based on the incorrect assumption of a flat Earth.',
        'r-q4': 'rhoxodrome',
        'r-q5': 'Bioluminescent reactions convert over 95% of energy to visible light with almost zero heat loss.',
        'r-q6': 'esca',
        'r-q7': 'counterillumination',
        'r-q8': 'NOT GIVEN'
      },
      highlights: [
        {
          id: 'hl-3',
          passageId: 'read-pass-1',
          text: 'guarantee that a drawn straight line corresponded to an unwavering compass bearing',
          color: 'yellow',
          timestamp: '2026-09-07T11:30:00Z'
        }
      ],
      completed: true
    },
    writingState: {
      timeRemainingSeconds: 0,
      task1Response: `The bar graph compares investments into four green energies in different regions over 15 years.

First of all, total investment jumped from 140 billion dollars to 580 billion dollars. Asia-Pacific had the largest growth, specially in solar power which increased from 42 billion to 185 billion in 2025. Europe also spent high money on wind turbines with 110 billion dollars.

In contrast, North America grew slower than Asia, reaching 88 billion in solar. Hydro and biomass remained stable with only moderate changes. To sum up, clean energy gained huge momentum globally.`,
      task2Response: `Nowadays, many countries are starting to apply computer AI systems into governmental sectors like court trials and traffic administration. Some citizens believe this improves speed and fair treatment, whereas others argue humans must keep full control over ethical decisions.

On the one hand, artificial intelligence can analyze big data much faster than human workers. For example, in smart cities, AI manages traffic lights smoothly without delays, saving fuel and time. Furthermore, machines do not get tired or angry, which might prevent emotional judgments in minor legal cases.

On the other hand, algorithms are created by human programmers and can carry unintended bias. If an AI decides prison terms, it cannot understand human emotions, repentance, or personal family difficulties. Ethical choices require empathy which computer chips do not possess.

In conclusion, I believe AI should only be an advisory tool. The final verdict must always be delivered by human judges who have ethical responsibility.`,
      completed: true
    },
    grading: {
      listeningScore: {
        raw: 8,
        band: 8.5,
        total: 8
      },
      readingScore: {
        raw: 8,
        band: 9.0,
        total: 8
      },
      isFinalized: false
    },
    lastSavedAt: '2026-09-07T12:30:00Z'
  },
  {
    candidateId: 'IG-410529',
    candidateName: 'Marcus Vance',
    candidatePhotoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
    examId: 'exam-ielts-academic-101',
    examTitle: 'IELTS Academic Practice Test 1 (Full Simulation)',
    createdAt: '2026-09-07T13:10:00Z',
    status: 'hard_locked',
    currentSection: 'reading',
    trfNumber: '26GB01428410529003C',
    lockStatus: {
      violations: 2,
      isLocked: true,
      lockReason: 'Secondary tab switch violation detected during Reading Module (Integrity lockdown).',
      lockHistory: [
        {
          timestamp: '2026-09-07T13:22:15Z',
          reason: 'Violation 1: Window blur / tab defocus detected during Reading Passage 1.'
        },
        {
          timestamp: '2026-09-07T13:28:40Z',
          reason: 'Violation 2: Hard Lock triggered. Unauthorized browser tab switch detected.'
        }
      ]
    },
    listeningState: {
      bufferedPercent: 100,
      audioPlayed: true,
      reviewTimerRemaining: 0,
      answers: {
        'l-q1': 'Sarah',
        'l-q2': 'Meadow Lane',
        'l-q3': 'B'
      },
      highlights: [],
      completed: true
    },
    readingState: {
      timeRemainingSeconds: 2450,
      answers: {
        'r-q1': 'TRUE',
        'r-q2': 'calfskin vellum'
      },
      highlights: [],
      completed: false
    },
    writingState: {
      timeRemainingSeconds: 3600,
      task1Response: '',
      task2Response: '',
      completed: false
    },
    grading: {
      isFinalized: false
    },
    lastSavedAt: '2026-09-07T13:28:40Z'
  },
  {
    candidateId: 'IG-772104',
    candidateName: 'Priya Sharma',
    candidatePhotoUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80',
    examId: 'exam-ielts-academic-101',
    examTitle: 'IELTS Academic Practice Test 1 (Full Simulation)',
    createdAt: '2026-09-07T14:00:00Z',
    status: 'registered',
    currentSection: 'listening',
    trfNumber: '26GB01428772104004D',
    lockStatus: {
      violations: 0,
      isLocked: false,
      lockHistory: []
    },
    listeningState: {
      bufferedPercent: 0,
      audioPlayed: false,
      reviewTimerRemaining: 120,
      answers: {},
      highlights: [],
      completed: false
    },
    readingState: {
      timeRemainingSeconds: 3600,
      answers: {},
      highlights: [],
      completed: false
    },
    writingState: {
      timeRemainingSeconds: 3600,
      task1Response: '',
      task2Response: '',
      completed: false
    },
    grading: {
      isFinalized: false
    },
    lastSavedAt: '2026-09-07T14:00:00Z'
  }
];
