import { Exam } from '../types';

export const defaultExam: Exam = {
  id: 'exam-ielts-academic-101',
  code: 'IELTS-AC-2026-01',
  title: 'IELTS Academic Practice Test 1 (Full Simulation)',
  listening: {
    title: 'Listening Practice Examination',
    sections: [
      {
        id: 'list-sec-1',
        sectionNumber: 1,
        title: 'Section 1: Community Cycling Club Membership Application',
        context: 'A conversation between a prospective member and the manager of a cycling community center.',
        audioDurationSeconds: 45, // Realistic demo duration with synthesis/cue
        audioScriptSnippet: 'Good morning! Welcome to the Westbridge Cycling Community Center. How may I assist you today? ... Great! I just need to note down a few details for your registration. What is your full name? ... Sarah Jenkins. And your residential address? ... 42 Meadow Lane. And which membership tier were you considering? ... The Standard Weekend plan, which includes Saturday morning guided rides.',
        questions: [
          {
            id: 'l-q1',
            number: 1,
            type: 'fill_in_the_blank',
            prompt: 'Applicant surname: Jenkins (First name: _______)',
            acceptedAnswers: ['Sarah', 'Sara'],
            explanation: 'The applicant clearly stated her first name is Sarah.'
          },
          {
            id: 'l-q2',
            number: 2,
            type: 'fill_in_the_blank',
            prompt: 'Residential Street: 42 _______ Lane',
            acceptedAnswers: ['Meadow', 'Meadow Lane'],
            explanation: 'Address was confirmed as 42 Meadow Lane.'
          },
          {
            id: 'l-q3',
            number: 3,
            type: 'multiple_choice',
            prompt: 'Which membership tier did Sarah select?',
            options: [
              'A) Premium All-Access',
              'B) Standard Weekend Plan',
              'C) Junior Development Squad',
              'D) Pay-As-You-Ride'
            ],
            acceptedAnswers: ['B', 'Standard Weekend Plan', 'B) Standard Weekend Plan'],
            explanation: 'She opted for the Standard Weekend plan with guided rides.'
          }
        ]
      },
      {
        id: 'list-sec-2',
        sectionNumber: 2,
        title: 'Section 2: Town Heritage Museum & Botanical Pavilion Plan',
        context: 'A guided orientation map walkthrough given by the museum curator.',
        audioDurationSeconds: 45,
        audioScriptSnippet: 'As you enter through the South Gateway, directly ahead is the Central Fountain. To the immediate left at Position A is the Antique Clock Gallery. Taking the northeast curved pathway past the rose garden brings you to Position B, our rare botanical nursery...',
        questions: [
          {
            id: 'l-q4',
            number: 4,
            type: 'diagram_label',
            prompt: 'Label the locations on the Museum & Pavilion Map below:',
            acceptedAnswers: ['Antique Clock Gallery', 'Clock Gallery', 'Antique Clock'],
            diagramConfig: {
              diagramType: 'map',
              title: 'Westbridge Heritage Botanical Pavilion Layout',
              labels: [
                { id: 'l-q4', labelNumber: 4, x: 22, y: 38, placeholder: 'Position A: ?' },
                { id: 'l-q5', labelNumber: 5, x: 74, y: 30, placeholder: 'Position B: ?' }
              ]
            },
            explanation: 'Position A on the western corridor is the Antique Clock Gallery.'
          },
          {
            id: 'l-q5',
            number: 5,
            type: 'fill_in_the_blank',
            prompt: 'Position B on the northeastern curved walkway is the: _______',
            acceptedAnswers: ['Botanical Nursery', 'Rare Botanical Nursery', 'Plant Nursery'],
            explanation: 'Position B is the rare botanical nursery.'
          }
        ]
      },
      {
        id: 'list-sec-3',
        sectionNumber: 3,
        title: 'Section 3: Environmental Engineering Seminar Proposal',
        context: 'Two postgraduate students discussing their sustainable wastewater filtration experiment.',
        audioDurationSeconds: 40,
        audioScriptSnippet: 'Leo, have you finished reviewing Dr. Harris’s notes on our sand-filter biochar substrate? ... Yes, the primary breakthrough was reducing nitrogen runoff by nearly 40 percent when we introduced porous volcanic pumice.',
        questions: [
          {
            id: 'l-q6',
            number: 6,
            type: 'multiple_choice',
            prompt: 'What was the primary benefit of adding volcanic pumice to the filtration bed?',
            options: [
              'A) Reduced overall water turbidity by 85%',
              'B) Decreased nitrogen runoff by nearly 40%',
              'C) Doubled the flow speed of the secondary drain',
              'D) Eliminated the need for bacterial sterilization'
            ],
            acceptedAnswers: ['B', 'Decreased nitrogen runoff by nearly 40%', 'B) Decreased nitrogen runoff by nearly 40%']
          },
          {
            id: 'l-q7',
            number: 7,
            type: 'fill_in_the_blank',
            prompt: 'The main organic substance blended with sand in the bio-filter was: _______',
            acceptedAnswers: ['biochar', 'bio char', 'biochar substrate'],
            explanation: 'The students examined the sand-filter biochar substrate.'
          }
        ]
      },
      {
        id: 'list-sec-4',
        sectionNumber: 4,
        title: 'Section 4: The Evolution of Ancient Agricultural Terracing',
        context: 'An academic lecture examining pre-Columbian agricultural irrigation in mountainous ecosystems.',
        audioDurationSeconds: 40,
        audioScriptSnippet: 'Stone terracing served not merely as soil retention, but as thermal heat sinks. The massive granite stones absorbed midday solar thermal radiation, warming night soils by up to 5 degrees Celsius...',
        questions: [
          {
            id: 'l-q8',
            number: 8,
            type: 'fill_in_the_blank',
            prompt: 'Granite stones in agricultural terraces functioned as thermal _______ to protect crops from night frost.',
            acceptedAnswers: ['heat sinks', 'sinks', 'heatsinks', 'heat sink'],
            explanation: 'The lecturer emphasized that the stones acted as thermal heat sinks.'
          }
        ]
      }
    ]
  },
  reading: {
    title: 'Reading Practice Examination',
    durationMinutes: 60,
    passages: [
      {
        id: 'read-pass-1',
        passageNumber: 1,
        title: 'Passage 1: The Evolution of Early Marine Cartography',
        subtitle: 'How ancient mariners navigated treacherous oceans before modern satellite telemetry.',
        text: `For centuries, human seafaring was limited by the terrifying prospect of the open ocean. Without reliable navigational charts, ancient navigators practiced cabotage—the method of sailing strictly along shorelines within sight of prominent coastal landmarks such as headlands, lighthouses, and distinct mountain summits. A sudden squall or thick fog could disorient even seasoned sailors, driving timber hulls onto jagged shoals.

The first significant technological leap came with the invention of the portolan chart in the thirteenth-century Mediterranean basin. Unlike modern maps oriented to true geographic north, portolan charts were crisscrossed with rhumb lines—radial lines radiating outwards from compass roses across 32 directional points. These allowed mariners to steer a constant magnetic course between departure ports and distant maritime trade depots. These charts were drawn primarily on calfskin vellum, prized for its durability in humid, saline ocean air.

However, portolan charts suffered from one critical mathematical flaw: they assumed the Earth was flat. While this approximation introduced negligible distortions across compact inland seas such as the Aegean or Adriatic, it created fatal inaccuracies when European explorers ventured into the expansive Atlantic and Indian Oceans. Because meridians of longitude converge at the poles on a spherical globe, plotting straight-line compass bearings on a flat plane progressively warped geographic distances.

It was not until Flemish geographer Gerardus Mercator published his groundbreaking cylindrical map projection in 1569 that sailors possessed a mathematically rigorous solution. Mercator designed his grid so that any straight line drawn across the chart represented a line of constant compass heading—known technically as a rhoxodrome or loxodrome. Although the Mercator projection notoriously exaggerated the surface area of landmasses situated near polar latitudes (famously making Greenland appear larger than South America), its navigational utility was unmatched. For navigator and captain alike, the guarantee that a drawn straight line corresponded to an unwavering compass bearing outweighed aesthetic landmass proportions.`,
        questions: [
          {
            id: 'r-q1',
            number: 1,
            type: 'true_false_not_given',
            prompt: 'Ancient navigators practicing cabotage avoided venturing out of sight of continental shorelines.',
            options: ['TRUE', 'FALSE', 'NOT GIVEN'],
            acceptedAnswers: ['TRUE', 'True', 'T'],
            explanation: 'The passage explicitly states cabotage was "sailing strictly along shorelines within sight of prominent coastal landmarks."'
          },
          {
            id: 'r-q2',
            number: 2,
            type: 'fill_in_the_blank',
            prompt: 'Portolan charts were drawn predominantly on _______ because of its resilience against damp, salty maritime conditions.',
            acceptedAnswers: ['calfskin vellum', 'vellum', 'calfskin'],
            explanation: 'Passage paragraph 2 notes they were drawn on "calfskin vellum, prized for its durability in humid, saline ocean air."'
          },
          {
            id: 'r-q3',
            number: 3,
            type: 'multiple_choice',
            prompt: 'Why were portolan charts unsuitable for long-distance transatlantic exploration?',
            options: [
              'A) They lacked directional compass roses.',
              'B) They were based on the incorrect assumption of a flat Earth.',
              'C) Vellum disintegrated in equatorial heat.',
              'D) Mariners were unable to calculate rhumb lines at night.'
            ],
            acceptedAnswers: ['B', 'They were based on the incorrect assumption of a flat Earth.', 'B) They were based on the incorrect assumption of a flat Earth.'],
            explanation: 'Paragraph 3 states their critical mathematical flaw: "they assumed the Earth was flat."'
          },
          {
            id: 'r-q4',
            number: 4,
            type: 'fill_in_the_blank',
            prompt: 'A straight line on Mercator’s projection representing a constant compass heading is known as a _______ or loxodrome.',
            acceptedAnswers: ['rhoxodrome', 'loxodrome'],
            explanation: 'Text specifies "known technically as a rhoxodrome or loxodrome."'
          }
        ]
      },
      {
        id: 'read-pass-2',
        passageNumber: 2,
        title: 'Passage 2: Bioluminescence in Abyssal Ocean Fauna',
        subtitle: 'The biochemical mechanics and evolutionary adaptations of living light in the midnight zone.',
        text: `In the aphotic midnight zone of the deep ocean—descending beyond one thousand meters beneath the surface where no sunlight ever penetrates—darkness is perpetual. Yet, far from being a barren void, this abyssal expanse twinkles with biological luminescence. Biologists estimate that upwards of seventy-five percent of deep-sea pelagic organisms possess the genetic capability to produce cold, biochemical illumination.

At the cellular core of this phenomenon lies an enzymatic reaction. A substrate compound known as luciferin reacts with oxygen in the presence of an organic catalyst, the enzyme luciferase. In several specialized organisms, this reaction is mediated by a co-factor such as adenosine triphosphate (ATP) or calcium ions. Unlike incandescence in human electric lightbulbs—where more than ninety percent of energy is wasted as thermal radiation—bioluminescence is extraordinarily efficient: over ninety-five percent of the liberated energy is radiated as visible light, with virtually zero thermal loss.

The evolutionary applications of abyssal bioluminescence are remarkably diverse. For predators such as the deep-sea anglerfish (Melanocetus johnsonii), a modified dorsal fin spine tipped with a glowing photophore called an esca serves as a glowing lure. Unsuspecting crustaceans and small teleost fish are drawn toward the pulsating glow in the pitch blackness, directly into the anglerfish’s cavernous jaws.

Conversely, prey species utilize light for concealment through counterillumination. Organisms such as the hatchetfish possess rows of photophores aligned along their ventral underbellies. By precisely modulating the intensity and wavelength of this downward light to match the dim residual downwelling sunlight filtering from surface waters, the silhouette of the hatchetfish is masked from predators hunting from below.`,
        questions: [
          {
            id: 'r-q5',
            number: 5,
            type: 'multiple_choice',
            prompt: 'What distinguishes bioluminescence from conventional incandescent human lighting?',
            options: [
              'A) Bioluminescence produces light in the ultraviolet spectrum only.',
              'B) Bioluminescent reactions convert over 95% of energy to visible light with almost zero heat loss.',
              'C) It requires intense ambient sunlight to recharge photophores.',
              'D) Incandescent filaments emit less thermal radiation than deep-sea enzymes.'
            ],
            acceptedAnswers: ['B', 'Bioluminescent reactions convert over 95% of energy to visible light with almost zero heat loss.', 'B) Bioluminescent reactions convert over 95% of energy to visible light with almost zero heat loss.']
          },
          {
            id: 'r-q6',
            number: 6,
            type: 'fill_in_the_blank',
            prompt: 'The glowing fleshy organ located on the modified dorsal spine of an anglerfish is known as an _______.',
            acceptedAnswers: ['esca', 'an esca'],
            explanation: 'The text defines it: "a glowing photophore called an esca."'
          },
          {
            id: 'r-q7',
            number: 7,
            type: 'fill_in_the_blank',
            prompt: 'Prey species like the hatchetfish avoid predators below by emitting ventral light in a camouflage strategy termed _______.',
            acceptedAnswers: ['counterillumination', 'counter-illumination', 'counter illumination'],
            explanation: 'Counterillumination matches downwelling light to dissolve silhouette.'
          },
          {
            id: 'r-q8',
            number: 8,
            type: 'true_false_not_given',
            prompt: 'Most organisms in the deep midnight zone lose their bioluminescence if brought to surface laboratories.',
            options: ['TRUE', 'FALSE', 'NOT GIVEN'],
            acceptedAnswers: ['NOT GIVEN', 'Not Given', 'NG'],
            explanation: 'The passage mentions deep-sea bioluminescence, but does not discuss surface laboratory survival.'
          }
        ]
      }
    ]
  },
  writing: {
    title: 'Writing Practice Examination',
    durationMinutes: 60,
    task1: {
      id: 'write-task-1',
      title: 'Writing Task 1: Renewable Energy Investment Data',
      prompt: 'The chart and table below illustrate global financial investment in renewable energy technologies (Solar, Wind, Hydroelectric, and Biomass) across four regions between 2010 and 2025.\n\nSummarise the information by selecting and reporting the main features, and make comparisons where relevant.\n\nWrite at least 150 words.',
      chartType: 'bar_chart',
      chartDescription: 'Comparative Bar Chart: Global Investment in Clean Energy by Region (2010 vs 2025, in Billion USD)',
      chartDataSummary: 'Solar PV: Asia-Pacific ($185B in 2025, up from $42B in 2010); Europe ($92B in 2025, up from $55B); North America ($88B in 2025, up from $31B). Wind: Europe leads with $110B in 2025, followed by North America ($74B) and Asia ($130B). Overall global renewable funding quadrupled from $140B to $580B.',
      chartData: {
        labels: ['Asia-Pacific', 'Europe', 'N. America'],
        unit: '$B',
        series: [
          { name: 'Solar 2010', values: [42, 55, 31] },
          { name: 'Solar 2025', values: [185, 92, 88] },
          { name: 'Wind 2025', values: [130, 110, 74] }
        ]
      },
      minWords: 150,
      visualMode: 'builtin'
    },
    task2: {
      id: 'write-task-2',
      title: 'Writing Task 2: AI & Automated Governance',
      prompt: 'Some people argue that artificial intelligence algorithms and automated predictive systems should be granted greater decision-making authority in urban management, criminal sentencing, and public resource allocation. Others contend that ethical judgments and judicial oversight must always remain strictly under human control.\n\nDiscuss both these views and give your own opinion.\n\nGive reasons for your answer and include any relevant examples from your own knowledge or experience.\n\nWrite at least 250 words.',
      essayType: 'discuss_both_views',
      minWords: 250
    }
  }
};

export const sampleExam = defaultExam;

export interface BlankExamInput {
  id: string;
  title: string;
  code: string;
  type: 'academic' | 'general_training';
  description?: string;
  centreNumber?: string;
}

/** A completely empty exam shell — no copied questions, passages or prompts. */
export function buildBlankExam(input: BlankExamInput): Exam {
  return {
    id: input.id,
    title: input.title,
    code: input.code,
    type: input.type,
    description: input.description || '',
    centreNumber: input.centreNumber || 'AZ001 - Baku Official IELTS Test Center',
    listening: {
      title: 'Listening Module',
      audioUploadMode: 'single',
      sections: [1, 2, 3, 4].map(n => ({
        id: `list-sec-${n}-${Date.now().toString(36)}`,
        sectionNumber: n,
        title: `Section ${n}`,
        context: '',
        audioDurationSeconds: 60,
        audioScriptSnippet: '',
        questions: []
      }))
    },
    reading: {
      title: 'Reading Module',
      durationMinutes: 60,
      passages: [1, 2, 3].map(n => ({
        id: `read-pass-${n}-${Date.now().toString(36)}`,
        passageNumber: n,
        title: `Passage ${n}`,
        text: '',
        questions: []
      }))
    },
    writing: {
      title: 'Writing Module',
      durationMinutes: 60,
      task1: {
        id: 'write-task-1',
        title: 'Writing Task 1',
        prompt: '',
        chartType: 'bar_chart',
        chartDescription: '',
        chartDataSummary: '',
        minWords: 150,
        visualMode: 'builtin'
      },
      task2: {
        id: 'write-task-2',
        title: 'Writing Task 2',
        prompt: '',
        essayType: 'agree_disagree',
        minWords: 250
      }
    },
    speaking: {
      title: 'Speaking Module'
    }
  };
}
