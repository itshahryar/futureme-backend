const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

/**
 * Call Gemini API with JSON output mode and multi-model fallback
 */
async function callGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const candidateModels = [
    GEMINI_MODEL,
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
  ].filter((v, i, a) => a.indexOf(v) === i);

  let lastError = null;

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini ${model} error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error(`Empty response from Gemini ${model}`);
      }

      return JSON.parse(text);
    } catch (err) {
      lastError = err;
      console.warn(`Attempt with ${model} failed, trying next candidate:`, err.message);
    }
  }

  throw lastError || new Error('All Gemini models failed');
}

/**
 * Rule-based fallback for Phase 3 (AI Skill Gap Analysis)
 */
function getFallbackSkillAnalysis(profileContext) {
  const { targetRole = 'Software Engineer', skills = [] } = profileContext;
  const lowerRole = targetRole.toLowerCase();

  const studentSkillNames = skills.map((s) => s.name?.toLowerCase() || '');
  const studentSkillMap = new Map();
  skills.forEach((s) => {
    if (s.name) studentSkillMap.set(s.name.toLowerCase(), s.proficiency || 'Beginner');
  });

  let benchmarkSkills = [];

  if (lowerRole.includes('frontend')) {
    benchmarkSkills = [
      { name: 'JavaScript (ES6+)', category: 'Frontend', minLevel: 'Intermediate', priority: 'Critical' },
      { name: 'React.js', category: 'Frontend', minLevel: 'Intermediate', priority: 'Critical' },
      { name: 'HTML5 & CSS3', category: 'Frontend', minLevel: 'Intermediate', priority: 'High' },
      { name: 'Tailwind CSS', category: 'Styling', minLevel: 'Intermediate', priority: 'High' },
      { name: 'TypeScript', category: 'Languages', minLevel: 'Intermediate', priority: 'High' },
      { name: 'State Management (Redux/Zustand)', category: 'Frontend Architecture', minLevel: 'Intermediate', priority: 'High' },
      { name: 'RESTful APIs & Fetch/Axios', category: 'Networking', minLevel: 'Intermediate', priority: 'High' },
      { name: 'Git & Version Control', category: 'DevOps & Tools', minLevel: 'Intermediate', priority: 'High' },
      { name: 'Web Performance & Optimization', category: 'Optimization', minLevel: 'Intermediate', priority: 'Medium' },
      { name: 'Next.js', category: 'Full Stack Frameworks', minLevel: 'Beginner', priority: 'Medium' },
    ];
  } else if (lowerRole.includes('backend')) {
    benchmarkSkills = [
      { name: 'Node.js & Express', category: 'Backend', minLevel: 'Intermediate', priority: 'Critical' },
      { name: 'SQL & Relational Databases (PostgreSQL)', category: 'Databases', minLevel: 'Intermediate', priority: 'Critical' },
      { name: 'REST API Design & Security', category: 'Backend Architecture', minLevel: 'Intermediate', priority: 'Critical' },
      { name: 'Authentication & JWT/OAuth', category: 'Security', minLevel: 'Intermediate', priority: 'High' },
      { name: 'Git & Version Control', category: 'DevOps & Tools', minLevel: 'Intermediate', priority: 'High' },
      { name: 'TypeScript', category: 'Languages', minLevel: 'Intermediate', priority: 'High' },
      { name: 'ORM / Query Builders (Prisma/TypeORM)', category: 'Databases', minLevel: 'Intermediate', priority: 'High' },
      { name: 'Docker & Containerization', category: 'DevOps', minLevel: 'Beginner', priority: 'Medium' },
      { name: 'Redis & Caching', category: 'Caching', minLevel: 'Beginner', priority: 'Medium' },
    ];
  } else {
    // Default Full Stack / Software Engineer
    benchmarkSkills = [
      { name: 'JavaScript & Modern ES6+', category: 'Languages', minLevel: 'Intermediate', priority: 'Critical' },
      { name: 'React.js', category: 'Frontend', minLevel: 'Intermediate', priority: 'Critical' },
      { name: 'Node.js & Express', category: 'Backend', minLevel: 'Intermediate', priority: 'Critical' },
      { name: 'SQL & Database Design', category: 'Databases', minLevel: 'Intermediate', priority: 'Critical' },
      { name: 'Git & Version Control', category: 'DevOps & Tools', minLevel: 'Intermediate', priority: 'High' },
      { name: 'RESTful API Integration', category: 'Networking', minLevel: 'Intermediate', priority: 'High' },
      { name: 'TypeScript', category: 'Languages', minLevel: 'Intermediate', priority: 'High' },
      { name: 'Docker Basics', category: 'DevOps', minLevel: 'Beginner', priority: 'Medium' },
    ];
  }

  const proficientSkills = [];
  const skillsToUpgrade = [];
  const missingSkills = [];

  benchmarkSkills.forEach((b) => {
    const hasSkill = studentSkillNames.some((n) => n.includes(b.name.toLowerCase()) || b.name.toLowerCase().includes(n));
    if (hasSkill) {
      const matchKey = Array.from(studentSkillMap.keys()).find((k) => k.includes(b.name.toLowerCase()) || b.name.toLowerCase().includes(k));
      const currentLevel = studentSkillMap.get(matchKey) || 'Beginner';

      const levelScore = { Beginner: 1, Intermediate: 2, Advanced: 3 };
      if ((levelScore[currentLevel] || 1) >= (levelScore[b.minLevel] || 2)) {
        proficientSkills.push({
          name: b.name,
          category: b.category,
          proficiency: currentLevel,
          reason: `Meets or exceeds the expected proficiency (${b.minLevel}) for ${targetRole}.`,
        });
      } else {
        skillsToUpgrade.push({
          name: b.name,
          currentLevel,
          targetLevel: b.minLevel,
          priority: b.priority,
          gapExplanation: `Currently at ${currentLevel} level; target role requires ${b.minLevel} with deeper practical implementation.`,
        });
      }
    } else {
      // Intelligently check if the missing skill is related to an existing student skill (e.g. React)
      // or if it is an independent career role prerequisite.
      const lowerName = b.name.toLowerCase();
      let relationType = 'CAREER_PATH_REQUIREMENT';
      let relatedToSkill = null;
      let relationDescription = `A core skill needed for any ${targetRole} job.`;

      const studentHasReact = studentSkillNames.some((n) => n.includes('react'));
      if (
        studentHasReact &&
        (lowerName.includes('next') ||
          lowerName.includes('redux') ||
          lowerName.includes('zustand') ||
          lowerName.includes('state management') ||
          lowerName.includes('tailwind') ||
          lowerName.includes('web performance'))
      ) {
        relationType = 'RELATED_TO_EXISTING_SKILL';
        relatedToSkill = 'React';
        relationDescription = 'Builds directly on what you already know in React, making it easier to learn.';
      } else {
        for (const s of skills) {
          const sName = (s.name || '').trim();
          if (sName && sName.length > 2 && lowerName.includes(sName.toLowerCase())) {
            relationType = 'RELATED_TO_EXISTING_SKILL';
            relatedToSkill = sName;
            relationDescription = `Connected to what you already know in ${sName}.`;
            break;
          }
        }
      }

      missingSkills.push({
        name: b.name,
        category: b.category,
        priority: b.priority,
        importance: `A valuable skill that companies look for in a ${targetRole}.`,
        relationType,
        relatedToSkill,
        relationDescription,
      });
    }
  });

  const totalEvaluated = benchmarkSkills.length;
  const matchScore = Math.min(
    100,
    Math.round(((proficientSkills.length * 1.0 + skillsToUpgrade.length * 0.45) / totalEvaluated) * 100)
  );

  return {
    matchScore,
    summary: `Your skills match ${matchScore}% of what employers look for in a ${targetRole}. You have a good foundation, with a few skills to practice and some new tools to learn before applying for jobs.`,
    strengths: proficientSkills.length
      ? proficientSkills.map((p) => `Good practical knowledge of ${p.name}`)
      : ['Strong interest in learning and solid academic coursework'],
    proficientSkills,
    skillsToUpgrade,
    missingSkills,
    recommendedFocusAreas: [
      ...skillsToUpgrade.slice(0, 2).map((s) => `Practice ${s.name} to reach ${s.targetLevel || 'Intermediate'} level`),
      ...missingSkills.slice(0, 2).map((m) => `Start learning ${m.name} with small projects`),
    ],
    estimatedTimeToReadiness: matchScore > 75 ? '1-2 months' : matchScore > 50 ? '2-3 months' : '3-5 months',
  };
}

/**
 * Phase 3: AI Skill Analysis & Gap Identification
 */
async function analyzeSkillGaps(profileContext) {
  const {
    targetRole = 'Frontend Developer',
    secondaryRoles = [],
    skills = [],
    academic = {},
    projects = [],
    experiences = [],
    certifications = [],
    goals = {},
  } = profileContext;

  const prompt = `
You are an expert technical career architect and lead engineering mentor.
Perform a thorough, realistic, and constructive Skill Gap Analysis for a student targeting the role of "${targetRole}".

STUDENT PROFILE DATA:
- Target Role (Primary): "${targetRole}"
- Secondary Target Roles: ${JSON.stringify(secondaryRoles)}
- Verified Current Skills: ${JSON.stringify(skills.map((s) => ({ name: s.name, level: s.proficiency, category: s.category })))}
- Academic Background: ${academic.degree || 'Degree In Progress'} from ${academic.school || 'University'} (Field: ${academic.fieldOfStudy || 'CS'}, Grade/GPA: ${academic.grade || 'N/A'})
- Portfolio Projects: ${JSON.stringify(projects.map((p) => ({ title: p.title, description: p.description, tech: p.technologies })))}
- Work / Internship Experience: ${JSON.stringify(experiences.map((e) => ({ role: e.roleTitle, company: e.companyName, description: e.description })))}
- Certifications: ${JSON.stringify(certifications.map((c) => ({ title: c.title, issuer: c.issuer })))}
- Career Goals: Short-Term: "${goals.shortTermGoal || ''}", Long-Term: "${goals.longTermGoal || ''}"

TASK:
Audit this profile against current real-world industry requirements for "${targetRole}".
Categorize skills into:
1. proficientSkills: Existing skills that meet or exceed industry standards for this role.
2. skillsToUpgrade: Existing skills where the student's current proficiency needs to be leveled up.
3. missingSkills: Crucial tools, frameworks, concepts, or practices standard for this role that the student lacks.

Return STRICT JSON adhering to this exact structure:
{
  "matchScore": number (integer between 0 and 100 representing overall readiness),
  "summary": string (2-3 sentences evaluating current standing and career readiness),
  "strengths": string[] (3 to 5 clear strength highlights),
  "proficientSkills": [
    {
      "name": string,
      "category": string,
      "proficiency": string ("Beginner" | "Intermediate" | "Advanced"),
      "reason": string
    }
  ],
  "skillsToUpgrade": [
    {
      "name": string,
      "currentLevel": string,
      "targetLevel": string,
      "priority": "High" | "Medium" | "Low",
      "gapExplanation": string
    }
  ],
  "missingSkills": [
    {
      "name": string,
      "category": string,
      "priority": "Critical" | "High" | "Medium",
      "importance": string,
      "relationType": "RELATED_TO_EXISTING_SKILL" | "CAREER_PATH_REQUIREMENT",
      "relatedToSkill": string | null,
      "relationDescription": string
    }
  ],
  "recommendedFocusAreas": string[] (3 to 5 clear immediate focus points),
  "estimatedTimeToReadiness": string (e.g. "2-4 months of focused study")
}

CRITICAL INSTRUCTION FOR MISSING SKILLS:
Analyze whether each missing skill is:
1) "RELATED_TO_EXISTING_SKILL": It directly complements, extends, or builds upon a skill the student already possesses (e.g. if the student knows React, then Next.js, Redux, React Query, Zustand, or Jest are related to React). Set "relationType": "RELATED_TO_EXISTING_SKILL", "relatedToSkill": "React" (or whichever existing skill it extends), and "relationDescription": a concise explanation of how it builds on that skill.
2) "CAREER_PATH_REQUIREMENT": It is a general requirement for the career role they chose (e.g. Docker, PostgreSQL, Node.js API Security for Full-Stack Developer). Set "relationType": "CAREER_PATH_REQUIREMENT", "relatedToSkill": null, and "relationDescription": explaining why it is a core requirement for "${targetRole}".

IMPORTANT LANGUAGE STYLE:
Write using simple, friendly, easy-to-read English. Do NOT use expensive, academic, or formal jargon (never use words like "benchmark", "pedagogical", "prerequisite", "competency", "readiness alignment", "comprehensive evaluation"). Write clear, motivating feedback like a supportive mentor talking directly to a beginner student.
`;

  try {
    return await callGemini(prompt);
  } catch (err) {
    console.warn('Gemini AI call failed, using intelligent benchmark engine:', err.message);
    return getFallbackSkillAnalysis(profileContext);
  }
}

/**
 * Rule-based fallback for Phase 4 (AI Learning Path & Modular Breakdown)
 */
function getFallbackLearningPath(profileContext, skillAnalysis) {
  const { targetRole = 'Frontend Developer' } = profileContext;
  const missing = skillAnalysis?.missingSkills || [];
  const upgrade = skillAnalysis?.skillsToUpgrade || [];

  const focusSkills = [
    ...upgrade.map((s) => s.name),
    ...missing.map((m) => m.name),
    'Git & Modern Collaboration',
    'Real-World Production Capstone',
  ].slice(0, 8);

  return {
    title: `${targetRole} Accelerated Career Mastery Path`,
    targetRole,
    description: `A structured 12-week progressive curriculum designed to eliminate your identified skill gaps and prepare you for high-impact ${targetRole} internships and entry-level roles.`,
    totalDurationWeeks: 12,
    milestones: [
      {
        id: 'milestone-1',
        title: 'Milestone 1: Core Fundamentals & Architectural Foundations',
        weekRange: 'Weeks 1 - 3',
        goal: 'Establish rock-solid proficiency in core language standards, component architecture, and modern best practices.',
        skillsCovered: focusSkills.slice(0, 2),
        topics: [
          {
            id: 'topic-1-1',
            title: `Advanced ${focusSkills[0] || 'Core Technologies'} Patterns`,
            skillCategory: 'Foundations',
            difficulty: 'Intermediate',
            estimatedHours: 15,
            subtopics: [
              {
                id: 'sub-1-1-1',
                title: 'Deep Dive into Language Semantics & Asynchronous Flow',
                description: 'Master async/await, closures, prototypes, event loop, and memory management.',
                keyConcepts: ['Event Loop', 'Promises', 'Microtasks', 'Closures'],
                practicalOutcome: 'Build an asynchronous utility library without third-party dependencies.',
              },
              {
                id: 'sub-1-1-2',
                title: 'Modern Modular Architecture & Tooling',
                description: 'Module bundlers, ES Modules, environment configs, and linting standards.',
                keyConcepts: ['ES Modules', 'Tree-shaking', 'Code Standards'],
                practicalOutcome: 'Configure a zero-config build pipeline with modern code standards.',
              },
            ],
          },
        ],
      },
      {
        id: 'milestone-2',
        title: 'Milestone 2: Framework Mastery & State Architecture',
        weekRange: 'Weeks 4 - 6',
        goal: 'Transition from basic usage to building production-grade, state-driven interfaces with resilient data fetching.',
        skillsCovered: focusSkills.slice(2, 4),
        topics: [
          {
            id: 'topic-2-1',
            title: `Production ${focusSkills[2] || 'Framework'} Engineering`,
            skillCategory: 'Frameworks',
            difficulty: 'Intermediate',
            estimatedHours: 18,
            subtopics: [
              {
                id: 'sub-2-1-1',
                title: 'Complex State Patterns & Performance Optimization',
                description: 'Analyze render cycles, memoization, custom hooks, and centralized stores.',
                keyConcepts: ['Context & Stores', 'Memoization', 'Custom Hooks', 'Virtual DOM'],
                practicalOutcome: 'Build a multi-tab analytical dashboard with cached server state.',
              },
            ],
          },
        ],
      },
      {
        id: 'milestone-3',
        title: 'Milestone 3: API Integration, Security & Testing',
        weekRange: 'Weeks 7 - 9',
        goal: 'Integrate external services, implement robust error boundaries, authentication tokens, and automated testing.',
        skillsCovered: focusSkills.slice(4, 6),
        topics: [
          {
            id: 'topic-3-1',
            title: 'Enterprise API Consumption & Resilient Data Fetching',
            skillCategory: 'Networking & Security',
            difficulty: 'Intermediate',
            estimatedHours: 16,
            subtopics: [
              {
                id: 'sub-3-1-1',
                title: 'JWT Handling, Axios/Fetch Interceptors & Security Best Practices',
                description: 'Protect client storage, manage refresh tokens, and guard routes.',
                keyConcepts: ['CORS', 'CSRF Protection', 'Interceptors', 'Route Guards'],
                practicalOutcome: 'Implement a secure authentication flow with automatic session refresh.',
              },
            ],
          },
        ],
      },
      {
        id: 'milestone-4',
        title: 'Milestone 4: Full-Scale Capstone Project & Deployment',
        weekRange: 'Weeks 10 - 12',
        goal: 'Build, launch, and host a complete project to show employers everything you have learned.',
        skillsCovered: focusSkills.slice(6),
        topics: [
          {
            id: 'topic-4-1',
            title: 'Production CI/CD, Containerization & Portfolio Launch',
            skillCategory: 'DevOps & Capstone',
            difficulty: 'Advanced',
            estimatedHours: 20,
            subtopics: [
              {
                id: 'sub-4-1-1',
                title: 'Live Cloud Deployment & Performance Auditing',
                description: 'Deploy to cloud hosting, configure automated GitHub Actions pipelines, and achieve 95+ Lighthouse scores.',
                keyConcepts: ['CI/CD Pipelines', 'Lighthouse Optimization', 'Cloud Hosting', 'Domain & SSL'],
                practicalOutcome: 'A live, production-grade application ready for resume inclusion.',
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Phase 4: AI Learning Path & Roadmap Generation
 */
async function generateLearningPath(profileContext, skillAnalysis) {
  const { targetRole = 'Frontend Developer', skills = [] } = profileContext;

  const prompt = `
You are an elite software engineering educator and curriculum director.
Design a highly structured, progressive, milestone-driven AI Learning Path for a student pursuing the role of "${targetRole}".

INPUT DATA:
- Target Role: "${targetRole}"
- Current Skills & Proficiencies: ${JSON.stringify(skills.map((s) => ({ name: s.name, level: s.proficiency })))}
- Skill Gap Analysis:
  - Match Score: ${skillAnalysis.matchScore || 0}%
  - Skills Needing Upgrade: ${JSON.stringify(skillAnalysis.skillsToUpgrade || [])}
  - Missing Required Skills: ${JSON.stringify(skillAnalysis.missingSkills || [])}
  - Recommended Focus Areas: ${JSON.stringify(skillAnalysis.recommendedFocusAreas || [])}

CURRICULUM DESIGN RULES:
1. The curriculum should span between 8 to 14 weeks organized into 3 to 5 logical Milestones.
2. Each Milestone must cover specific skills, have clear weekly timeframes, a concrete milestone goal, and 1 to 3 organized Topics.
3. Each Topic must break down into 2 to 3 practical Subtopics.
4. Each Subtopic must specify:
   - title
   - description (practical and conceptual)
   - keyConcepts (array of 3-5 technical keywords/concepts)
   - practicalOutcome (a concrete mini-project or code artifact created)
5. Directly address the student's identified missing skills and upgrade needs.

Return STRICT JSON adhering to this exact structure:
{
  "title": string (e.g. "Frontend Engineering Career Path: Zero to Production"),
  "targetRole": string,
  "description": string (2-3 sentences overview of the learning journey),
  "totalDurationWeeks": number (e.g. 12),
  "milestones": [
    {
      "id": string (unique ID like "milestone-1"),
      "title": string,
      "weekRange": string (e.g. "Weeks 1 - 3"),
      "goal": string,
      "skillsCovered": string[],
      "topics": [
        {
          "id": string (unique ID like "topic-1-1"),
          "title": string,
          "skillCategory": string,
          "difficulty": "Beginner" | "Intermediate" | "Advanced",
          "estimatedHours": number,
          "subtopics": [
            {
              "id": string (unique ID like "sub-1-1-1"),
              "title": string,
              "description": string,
              "keyConcepts": string[],
              "practicalOutcome": string
            }
          ]
        }
      ]
    }
  ]
}
`;

  try {
    return await callGemini(prompt);
  } catch (err) {
    console.warn('Gemini AI path generation failed, using intelligent fallback:', err.message);
    return getFallbackLearningPath(profileContext, skillAnalysis);
  }
}

/**
 * Fallback topic content generator
 */
function getFallbackTopicContent(topicContext) {
  const { topicTitle = 'Core Software Concepts', skillCategory = 'Software Engineering', targetRole = 'Software Engineer' } = topicContext;

  return {
    topicTitle,
    skillCategory,
    overview: `This module covers essential production principles for ${topicTitle}. You will master how this component fits into scalable ${targetRole} workflows and learn how to write robust, maintainable code.`,
    keyConcepts: [
      { concept: 'Core Architecture', summary: 'Understanding the underlying lifecycle and how data flows through this module.' },
      { concept: 'Production Reliability', summary: 'Handling errors, edge cases, and asynchronous state transitions safely.' },
      { concept: 'Performance Optimization', summary: 'Techniques to minimize latency, reduce memory footprint, and write non-blocking logic.' }
    ],
    detailedContent: `### Understanding ${topicTitle}

In modern ${targetRole} architectures, **${topicTitle}** plays a critical role in application reliability and scalability.

#### 1. Core Principles
- Modular separation of concerns
- Safe error propagation and centralized handling
- Defensive coding against malformed inputs and concurrency issues

#### 2. Practical Execution
When implementing ${topicTitle}, always ensure that your abstractions are testable and decoupled from external side-effects.`,
    codeExamples: [
      {
        title: `Standard Implementation Pattern for ${topicTitle}`,
        language: 'javascript',
        code: `// Scalable implementation example for ${topicTitle}
async function handleOperation(payload) {
  try {
    if (!payload) throw new Error('Invalid payload');
    const result = await processData(payload);
    return { success: true, data: result };
  } catch (error) {
    console.error('Operation failed:', error.message);
    throw error;
  }
}`,
        explanation: 'Uses asynchronous boundaries with structured error bubbling to ensure caller receives predictable outcomes.'
      }
    ],
    bestPractices: [
      'Write isolated unit tests covering both the happy path and edge-case exceptions.',
      'Always sanitize and validate external parameters before processing.',
      'Log structured metrics for debugging in production environments.'
    ],
    commonPitfalls: [
      'Swallowing exceptions silently without logging or alerting.',
      'Blocking execution with synchronous operations in high-throughput paths.'
    ],
    resources: [
      {
        title: `${topicTitle} - Official Documentation`,
        type: 'Documentation',
        url: 'https://developer.mozilla.org/en-US/docs/Web',
        description: 'Official guides, documentation, and standard code examples.',
        isFree: true
      },
      {
        title: 'Building Real-World Systems - FreeCodeCamp Guide',
        type: 'Article',
        url: 'https://www.freecodecamp.org/news',
        description: 'Practical tutorial explaining how this works in real projects.',
        isFree: true
      },
      {
        title: `${topicTitle} Hands-on Crash Course`,
        type: 'Video',
        url: 'https://www.youtube.com',
        description: 'Step-by-step visual walkthrough building a real production project.',
        isFree: true
      }
    ]
  };
}

/**
 * Phase 5: Generate Topic Learning Content & Curated Resources
 */
async function generateTopicContent(topicContext) {
  const { topicTitle, skillCategory, difficulty, subtopics = [], targetRole } = topicContext;

  const prompt = `
You are a Principal Technical Architect & Educator at FutureMe.
Generate comprehensive, highly educational learning content and curated external resources for the following topic:
Topic: "${topicTitle}"
Category: "${skillCategory || 'Software Engineering'}"
Difficulty: "${difficulty || 'Intermediate'}"
Target Career Role: "${targetRole || 'Software Engineer'}"
Subtopics to cover: ${JSON.stringify(subtopics.map(s => typeof s === 'string' ? s : s.title || s))}

Respond with ONLY valid JSON adhering strictly to this schema:
{
  "topicTitle": string,
  "skillCategory": string,
  "overview": string (2-3 sentences explaining what this is and why it matters in industry),
  "keyConcepts": [
    { "concept": string, "summary": string }
  ],
  "detailedContent": string (rich Markdown tutorial with code blocks, architecture explanations, and step-by-step walkthrough),
  "codeExamples": [
    {
      "title": string,
      "language": string,
      "code": string,
      "explanation": string
    }
  ],
  "bestPractices": string[],
  "commonPitfalls": string[],
  "resources": [
    {
      "title": string,
      "type": "Documentation" | "Video" | "Article" | "Interactive",
      "url": string (real, reputable URL e.g. MDN, official docs, freecodecamp, github),
      "description": string,
      "isFree": boolean
    }
  ]
}
`;

  try {
    return await callGemini(prompt);
  } catch (err) {
    console.warn('Gemini topic content generation failed, using intelligent fallback:', err.message);
    return getFallbackTopicContent(topicContext);
  }
}

/**
 * Fallback topic assessment generator
 */
function getFallbackTopicAssessment(topicContext) {
  const { topicTitle = 'Core Software Concepts', skillCategory = 'Software Engineering' } = topicContext;
  const inferredSkill = topicTitle.split(' ')[0] || skillCategory || 'Software Engineering';

  return {
    topicTitle,
    skillName: inferredSkill,
    passingScore: 70,
    questions: [
      {
        id: 'q-1',
        question: `What is the primary architectural advantage of implementing ${topicTitle} correctly?`,
        scenario: 'You are reviewing a pull request for a microservice handling high-throughput production requests.',
        options: [
          'It eliminates the need for database indexes entirely',
          'It improves modularity, testability, and non-blocking asynchronous throughput',
          'It automatically converts code into machine language at compile time',
          'It reduces all network calls to zero milliseconds'
        ],
        correctIndex: 1,
        explanation: 'Correct implementation ensures decoupled components, predictable error boundaries, and scalable asynchronous resource utilization.'
      },
      {
        id: 'q-2',
        question: `Which of the following is considered an anti-pattern when working with ${topicTitle}?`,
        scenario: 'A production bug occurred where uncaught exceptions caused worker processes to exit without notifications.',
        options: [
          'Writing comprehensive unit and integration tests',
          'Silently swallowing errors with an empty catch block without logging or propagation',
          'Utilizing environment variables for secrets and external API configurations',
          'Encapsulating business logic inside pure functions'
        ],
        correctIndex: 1,
        explanation: 'Swallowing errors hides failures from monitoring tools and leaves the system in an unpredictable state.'
      },
      {
        id: 'q-3',
        question: `When deploying code related to ${topicTitle} in a production environment, what practice should always be followed?`,
        scenario: 'Preparing for a zero-downtime rolling deployment to a cloud Kubernetes cluster.',
        options: [
          'Hardcode test credentials directly in the repository for faster debugging',
          'Disable health checks to speed up pod startup times',
          'Validate configurations, monitor health metrics, and employ automated rollback triggers',
          'Run memory-intensive tasks synchronously inside the main request thread'
        ],
        correctIndex: 2,
        explanation: 'Production readiness requires externalized configuration, active health probes, and automated rollback strategies.'
      }
    ]
  };
}

/**
 * Phase 6: Generate Topic Quiz / Assessment
 */
async function generateTopicAssessment(topicContext) {
  const { topicTitle, skillCategory, difficulty, targetRole } = topicContext;

  const prompt = `
You are a Principal Technical Assessor at FutureMe.
Generate a high-yield 3-question multiple choice assessment for the topic:
Topic: "${topicTitle}"
Category: "${skillCategory || 'Software Engineering'}"
Difficulty: "${difficulty || 'Intermediate'}"
Target Role: "${targetRole || 'Software Engineer'}"

The questions must test practical, real-world understanding and edge-case handling, not trivial definitions.
Respond with ONLY valid JSON adhering strictly to this schema:
{
  "topicTitle": string,
  "skillName": string (the primary technical skill evaluated, e.g. "Docker", "Node.js", "PostgreSQL", "React", "TypeScript"),
  "passingScore": 70,
  "questions": [
    {
      "id": string (e.g. "q-1", "q-2", "q-3"),
      "question": string,
      "scenario": string (a short 1-sentence real-world production context),
      "options": string[] (exactly 4 options),
      "correctIndex": number (0 to 3),
      "explanation": string (concise explanation of why the correct option is right and the others are flawed)
    }
  ]
}
`;

  try {
    return await callGemini(prompt);
  } catch (err) {
    console.warn('Gemini quiz generation failed, using intelligent fallback:', err.message);
    return getFallbackTopicAssessment(topicContext);
  }
}

module.exports = {
  analyzeSkillGaps,
  generateLearningPath,
  generateTopicContent,
  generateTopicAssessment,
};
