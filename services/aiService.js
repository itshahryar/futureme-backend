const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { resolveAuthenticatedResources } = require('./resourceResolver');

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
 * Fallback topic content generator with technology-specific rich content
 */
function getFallbackTopicContent(topicContext) {
  const { topicTitle = 'Core Software Concepts', skillCategory = 'Software Engineering', targetRole = 'Software Engineer' } = topicContext;
  const lower = (topicTitle + ' ' + (skillCategory || '')).toLowerCase();

  let codeExample = {
    title: `Production Implementation Pattern for ${topicTitle}`,
    language: 'javascript',
    code: `// Resilient architecture pattern for ${topicTitle}
export async function executeOperation(config = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch('/api/v1/resource', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(\`HTTP \${response.status}: Failed to execute \${config.action || 'operation'}\`);
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('Request timed out after 8s');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}`,
    explanation: 'Demonstrates resilient network invocation with automatic timeout aborts, explicit error classification, and cleanup.',
  };

  let detailed = `### Comprehensive Guide: ${topicTitle}

In modern ${targetRole} workflows, **${topicTitle}** serves as a core architectural pillar for system reliability and maintainability.

#### 1. Fundamental Principles & Architecture
- **Separation of Concerns**: Decouple logic from external infrastructure so modules can be tested and modified independently.
- **Fail-Safe Execution**: Every asynchronous and boundary-crossing operation must include structured error propagation.
- **Defensive Design**: Validate and sanitize all incoming parameters before state transitions or downstream calls.

#### 2. Implementation Walkthrough
When integrating ${topicTitle} into production codebases:
1. Establish standard contracts and interface definitions first.
2. Encapsulate implementation details inside cohesive helper modules or service classes.
3. Write isolated unit and integration tests covering standard execution as well as edge-case exceptions.

#### 3. Production Monitoring & Optimization
Ensure all failure pathways emit structured logs with contextual telemetry (timestamps, trace IDs, and sanitized parameters) to enable rapid root-cause analysis in distributed environments.`;

  // Technology-specific rich content
  if (lower.includes('docker') || lower.includes('container') || lower.includes('devops')) {
    codeExample = {
      title: 'Production Multi-stage Dockerfile (Node.js & Alpine)',
      language: 'dockerfile',
      code: `# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --prefer-offline --no-audit
COPY . .
RUN npm run build && npm prune --production

# Stage 2: Minimal Production Runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -s /bin/sh -D nodejs

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./package.json

USER nodejs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]`,
      explanation: 'Multi-stage build eliminates build tools and devDependencies from the final container image, reducing size by up to 80% and mitigating vulnerabilities.',
    };

    detailed = `### Deep Dive: Docker Containerization & Multi-stage Builds

Containerization provides an immutable, reproducible runtime across development, staging, and production environments.

#### 1. Why Multi-stage Builds Matter
Traditional Docker builds include compilers, linters, devDependencies, and test runners directly in the shipped container. Multi-stage builds solve this by separating the **build stage** from the **runtime stage**:
- **Drastically Reduced Image Size**: Only runtime binaries and production node_modules exist in the final artifact.
- **Hardened Security Surface**: Attack tools (compilers, package managers) are completely absent from production images.
- **Optimal Layer Caching**: Placing dependency manifests (\`package.json\`) ahead of source code prevents unnecessary \`npm install\` runs when only application code changes.

#### 2. Production Checklist
1. Never run containers as the \`root\` user—always create an unprivileged service user (e.g., \`USER nodejs\`).
2. Implement built-in container \`HEALTHCHECK\` directives for Kubernetes/ECS orchestrators.
3. Pin base image versions strictly (e.g. \`node:20.11-alpine3.19\` instead of \`node:latest\`).`;
  } else if (lower.includes('react') || lower.includes('jsx') || lower.includes('frontend')) {
    codeExample = {
      title: 'Advanced React Custom Hook Pattern (useDebounce & AbortController)',
      language: 'javascript',
      code: `import { useState, useEffect, useRef } from 'react';

export function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function useSearchQuery(searchQuery) {
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const debouncedQuery = useDebounce(searchQuery, 400);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }

    const abortController = new AbortController();
    setIsLoading(true);

    fetch(\`/api/search?q=\${encodeURIComponent(debouncedQuery)}\`, {
      signal: abortController.signal
    })
      .then(res => res.json())
      .then(data => setResults(data.items || []))
      .catch(err => {
        if (err.name !== 'AbortError') console.error('Search failed:', err);
      })
      .finally(() => setIsLoading(false));

    return () => abortController.abort();
  }, [debouncedQuery]);

  return { results, isLoading };
}`,
      explanation: 'Combines debouncing with clean cancellation via AbortController to eliminate race conditions and avoid unnecessary server calls.',
    };

    detailed = `### Deep Dive: Advanced React.js Patterns & Component Architecture

Modern React engineering focuses on composability, custom hook abstractions, and state decoupling.

#### 1. Core Principles
- **Hooks as Behavioral Contracts**: Encapsulate reusable state and side-effects into custom hooks (\`useSearchQuery\`, \`useAuth\`), keeping UI components purely declarative.
- **Race Condition Prevention**: Whenever network requests are triggered inside \`useEffect\`, always clean up using \`AbortController\` to discard stale responses from out-of-order completions.
- **Render Optimization**: Use \`useMemo\` and \`useCallback\` with purpose—benchmark re-renders rather than prematurely optimizing primitive values.

#### 2. Practical Execution Guidelines
1. Keep component state local until two or more sibling components genuinely share ownership.
2. Structure compound components using React Context for accessible widgets like tabs, modals, and dropdowns.
3. Treat props as immutable inputs and maintain single sources of truth.`;
  } else if (lower.includes('html') || lower.includes('css')) {
    codeExample = {
      title: 'Semantic HTML5 Structure with Modern CSS Grid & Flexbox',
      language: 'html',
      code: `<!-- Accessible, Semantic Production HTML5 Layout -->
<main class="page-container">
  <header class="hero-section">
    <nav aria-label="Main Navigation" class="main-nav">
      <a href="/" class="brand-logo">FutureMe</a>
      <ul class="nav-links">
        <li><a href="/dashboard">Dashboard</a></li>
        <li><a href="/roadmap">Roadmap</a></li>
      </ul>
    </nav>
    <h1>Modern Frontend Architecture</h1>
  </header>

  <section class="content-grid" aria-labelledby="modules-title">
    <h2 id="modules-title" class="sr-only">Learning Modules</h2>
    <article class="card">
      <h3>Design Systems</h3>
      <p>Building cohesive component libraries with CSS custom properties.</p>
    </article>
    <article class="card">
      <h3>Responsive Layouts</h3>
      <p>Fluid grids using auto-fit and minmax without media queries.</p>
    </article>
  </section>
</main>

<style>
  .content-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
    padding: 2rem 1rem;
    max-width: 1200px;
    margin: 0 auto;
  }
  .card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 0.75rem;
    padding: 1.5rem;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }
  .card:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
  }
</style>`,
      explanation: 'Employs proper semantic landmark elements (<main>, <header>, <section>, <article>) paired with an intrinsic responsive grid that adapts across all screen widths without fragile breakpoints.',
    };

    detailed = `### Deep Dive: Production HTML5 & CSS3 Engineering

High-performance web applications require solid semantic foundations and robust layout methodologies.

#### 1. Semantic Architecture & Accessibility (a11y)
- **Landmark Elements**: Use \`<main>\`, \`<nav>\`, \`<header>\`, \`<footer>\`, and \`<section>\` so assistive technologies (screen readers) can easily navigate the document hierarchy.
- **Heading Hierarchy**: Maintain a strict \`<h1>\` to \`<h6>\` heading sequence without skipping levels for visual styling.
- **Forms & Inputs**: Always associate \`<label for="id">\` explicitly with form controls to ensure accessible touch targets and voice navigation.

#### 2. Modern CSS Layout Strategies
- **CSS Grid for Macro Layouts**: Leverage \`repeat(auto-fit, minmax(280px, 1fr))\` for intrinsic 2D responsiveness that rearranges columns naturally.
- **Flexbox for Micro Components**: Use Flexbox for 1D alignments like navigation bars, badge lists, and button groups.
- **CSS Custom Properties**: Maintain a design token system (\`--color-primary\`, \`--radius-md\`) for consistent theming and dark mode adaptation.`;
  } else if (lower.includes('node') || lower.includes('express')) {
    codeExample = {
      title: 'Production Express Router with Validation & Centralized Error Middleware',
      language: 'javascript',
      code: `const express = require('express');
const router = express.Router();

// Modular Async Handler to avoid repetitive try/catch boilerplate
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Validation Middleware
function validateUserPayload(req, res, next) {
  const { email, role } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email address is required' });
  }
  req.sanitizedEmail = email.trim().toLowerCase();
  next();
}

// Controller route
router.post('/register', validateUserPayload, asyncHandler(async (req, res) => {
  const user = await createUserRecord({
    email: req.sanitizedEmail,
    role: req.body.role || 'STUDENT',
  });
  return res.status(201).json({ success: true, user });
}));

// Centralized error-handling middleware
router.use((err, req, res, next) => {
  console.error('[API Error]:', err.message, err.stack);
  const status = err.statusCode || 500;
  res.status(status).json({
    success: false,
    error: status === 500 ? 'Internal Server Error' : err.message,
  });
});

module.exports = router;`,
      explanation: 'Production Express router featuring modular async wrapping, input sanitation middleware, and structured 4-argument centralized error handling.',
    };

    detailed = `### Deep Dive: Production Node.js & Express Engineering

Building high-throughput, fault-tolerant backend services requires strict adherence to asynchronous runtime best practices.

#### 1. Core Principles
- **Non-blocking Event Loop**: Never execute CPU-heavy synchronous operations (\`fs.readFileSync\`, heavy loops) on the main thread; offload to worker threads or external queues.
- **Centralized Error Propagation**: Unhandled promise rejections can crash the Node process. Use standard 4-argument error middlewares to capture and log every exception.
- **Environment & Secret Hygiene**: Never hardcode configuration strings; load credentials dynamically via validated environment variables.`;
  }

  return {
    topicTitle,
    skillCategory,
    overview: `This module covers essential production principles for ${topicTitle}. You will master how this component fits into scalable ${targetRole} workflows and learn how to write robust, maintainable code.`,
    keyConcepts: [
      { concept: 'Core Architecture', summary: 'Understanding the underlying lifecycle and how data flows through this module.' },
      { concept: 'Production Reliability', summary: 'Handling errors, edge cases, and asynchronous state transitions safely.' },
      { concept: 'Performance Optimization', summary: 'Techniques to minimize latency, reduce memory footprint, and write non-blocking logic.' }
    ],
    detailedContent: detailed,
    codeExamples: [codeExample],
    bestPractices: [
      'Write isolated unit tests covering both the happy path and edge-case exceptions.',
      'Always sanitize and validate external parameters before processing.',
      'Log structured metrics for debugging in production environments.'
    ],
    commonPitfalls: [
      'Swallowing exceptions silently without logging or alerting.',
      'Blocking execution with synchronous operations in high-throughput paths.'
    ],
    resources: resolveAuthenticatedResources(topicTitle, skillCategory),
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

CRITICAL REQUIREMENTS:
1. "detailedContent": Must be a rich, thorough, in-depth Markdown tutorial (at least 600-800 words) with clear architectural breakdowns, deep technical explanations, and practical production guidance.
2. "codeExamples": Must contain REAL, PRODUCTION-GRADE code specifically written for "${topicTitle}". NEVER provide generic or placeholder examples! (e.g. For Docker provide an authentic multi-stage Dockerfile; for React provide authentic custom hooks/components; for CSS provide modern CSS Grid/Flexbox; for Node/Express provide authentic routers/middleware).
3. "resources": Provide authentic, high-quality resources.

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
      "url": string,
      "description": string,
      "isFree": boolean
    }
  ]
}
`;

  try {
    const aiResult = await callGemini(prompt);
    return {
      ...aiResult,
      // Authenticate and guarantee that all resources are direct, authentic, non-broken links
      resources: resolveAuthenticatedResources(topicTitle, skillCategory),
    };
  } catch (err) {
    console.warn('Gemini topic content generation failed, using intelligent fallback:', err.message);
    return getFallbackTopicContent(topicContext);
  }
}

/**
 * Fallback topic assessment generator (12 Questions: 4 Easy, 4 Medium, 4 Hard)
 */
function getFallbackTopicAssessment(topicContext) {
  const { topicTitle = 'Core Software Concepts', skillCategory = 'Software Engineering' } = topicContext;
  const inferredSkill = topicTitle.split(' ')[0] || skillCategory || 'Software Engineering';

  return {
    topicTitle,
    skillName: inferredSkill,
    passingScore: 70,
    questions: [
      // 1-4: EASY QUESTIONS (Fundamentals, Definitions & Syntax)
      {
        id: 'q-1',
        difficulty: 'Easy',
        question: `What is the primary purpose and definition of ${topicTitle}?`,
        scenario: 'You are introducing the architecture of a new application to junior team members.',
        options: [
          'A proprietary system that completely replaces all database drivers and network protocols',
          `A standardized approach to building, organizing, and maintaining scalable ${topicTitle} logic`,
          'A tool used solely to compile code into assembly language without debugging',
          'A hardware accelerator used for physical network load balancers'
        ],
        correctIndex: 1,
        explanation: `${topicTitle} provides a standardized, maintainable pattern for implementing and managing software capabilities reliably.`
      },
      {
        id: 'q-2',
        difficulty: 'Easy',
        question: `Which fundamental building block is most central to working with ${topicTitle}?`,
        scenario: 'Setting up the base development environment and project structure for a new feature branch.',
        options: [
          'Random binary memory offsets without variable bindings',
          'Clearly defined modular components, structured interfaces, and explicit inputs/outputs',
          'Unversioned global variables accessible across all system threads',
          'Hardcoded IP addresses inside client-facing application views'
        ],
        correctIndex: 1,
        explanation: 'Modular structure, clear interfaces, and predictable data flow form the core foundation of reliable development.'
      },
      {
        id: 'q-3',
        difficulty: 'Easy',
        question: `What is a primary advantage of adopting ${topicTitle} in a modern web codebase?`,
        scenario: 'Your engineering team evaluates technical debt and chooses modern standards.',
        options: [
          'It guarantees zero latency regardless of internet connection speed',
          'It eliminates the need for unit tests or code reviews',
          'It enhances code reusability, maintainability, and predictable developer collaboration',
          'It permanently bypasses web security policies and browser restrictions'
        ],
        correctIndex: 2,
        explanation: 'Consistent architectural patterns dramatically improve readability, onboarding speed, and long-term codebase health.'
      },
      {
        id: 'q-4',
        difficulty: 'Easy',
        question: `When initializing a module or component using ${topicTitle}, what convention is recommended?`,
        scenario: 'Bootstrapping a new service file following standard team conventions.',
        options: [
          'Naming files randomly with numbers and avoiding version control commits',
          'Following consistent naming conventions, explicit imports, and strict type/linter rules',
          'Declaring all variables in the global namespace to skip import statements',
          'Disabling all runtime logging and warnings to maximize build speed'
        ],
        correctIndex: 1,
        explanation: 'Clean file organization, strict linting, and explicit imports prevent dependency conflicts and runtime confusion.'
      },

      // 5-8: MEDIUM QUESTIONS (Implementation, Lifecycle, Error Handling & Testing)
      {
        id: 'q-5',
        difficulty: 'Medium',
        question: `How should state and lifecycle changes be managed when implementing ${topicTitle}?`,
        scenario: 'A state update in one view needs to notify dependent components without triggering unnecessary re-renders.',
        options: [
          'Mutating the global DOM tree directly from arbitrary asynchronous timeouts',
          'Using predictable, immutable state transitions with unidirectional data flow',
          'Duplicating identical state variables across every component hierarchy',
          'Polling an external REST API every millisecond synchronously'
        ],
        correctIndex: 1,
        explanation: 'Immutable updates and unidirectional flow guarantee predictable state synchronization and eliminate stale state bugs.'
      },
      {
        id: 'q-6',
        difficulty: 'Medium',
        question: `What is the recommended approach for handling asynchronous exceptions in ${topicTitle}?`,
        scenario: 'An external API request fails intermittently due to temporary network timeouts.',
        options: [
          'Silently catch the error with an empty block so the UI never displays an error',
          'Terminate the entire client process immediately on the first network hiccup',
          'Implement structured try-catch or rejection handlers with user feedback and exponential backoff retries',
          'Ignore the promise rejection and assume data will arrive eventually'
        ],
        correctIndex: 2,
        explanation: 'Resilient applications handle transient failures gracefully through bounded retries, logging, and intuitive fallback UI.'
      },
      {
        id: 'q-7',
        difficulty: 'Medium',
        question: `Which of the following is considered an anti-pattern when developing with ${topicTitle}?`,
        scenario: 'Refactoring a high-traffic service that suffers from frequent regressions and tight coupling.',
        options: [
          'Writing comprehensive integration tests for critical business paths',
          'Tightly coupling business logic directly inside view layers without separation of concerns',
          'Validating API payloads against strict schemas before persisting data',
          'Extracting repeatable utility calculations into pure helper functions'
        ],
        correctIndex: 1,
        explanation: 'Mixing presentation and business logic breaks reusability, hinders unit testing, and increases regression risk.'
      },
      {
        id: 'q-8',
        difficulty: 'Medium',
        question: `When writing automated tests for features built with ${topicTitle}, what strategy is most effective?`,
        scenario: 'Configuring Continuous Integration (CI) test suites to run on every pull request.',
        options: [
          'Only test with manual console logs in production environments',
          'Mock external I/O and network boundaries while testing core user interactions and edge conditions',
          'Test only happy paths and ignore edge cases to keep test suites green',
          'Avoid mocking and require live third-party payment gateways for every unit test'
        ],
        correctIndex: 1,
        explanation: 'Mocking external boundaries creates fast, deterministic tests while verifying business logic under both success and error conditions.'
      },

      // 9-12: HARD QUESTIONS (Architecture, High Scale, Performance & Security)
      {
        id: 'q-9',
        difficulty: 'Hard',
        question: `Under heavy production traffic, how can you prevent memory leaks and thread exhaustion in ${topicTitle}?`,
        scenario: 'A microservice exhibits gradual memory growth under sustained load over several days.',
        options: [
          'Reboot the host server every 10 minutes using a scheduled cron script',
          'Clean up event listeners, cancel pending subscriptions, and avoid retaining references in unbounded global caches',
          'Disable garbage collection completely to decrease CPU usage',
          'Increase machine RAM infinitely without profiling heap dumps'
        ],
        correctIndex: 1,
        explanation: 'Dangling event listeners, unclosed streams, and unbounded collections are the leading causes of production memory leaks.'
      },
      {
        id: 'q-10',
        difficulty: 'Hard',
        question: `How should zero-downtime deployments and horizontal scaling be orchestrated for systems running ${topicTitle}?`,
        scenario: 'Deploying a major architectural release to a cloud cluster serving thousands of concurrent users.',
        options: [
          'Deploy during peak traffic hours without database backup or rolling health probes',
          'Employ stateless worker nodes, container health checks, gradual canary rollouts, and backward-compatible schema changes',
          'Shut down all servers simultaneously to replace binary files in-place',
          'Store session states exclusively in local server process memory'
        ],
        correctIndex: 1,
        explanation: 'Stateless instances, robust health checks, and backward-compatible migrations allow rolling updates without downtime.'
      },
      {
        id: 'q-11',
        difficulty: 'Hard',
        question: `How do you resolve race conditions and optimistic concurrency conflicts in ${topicTitle}?`,
        scenario: 'Two concurrent users attempt to update the same shared resource at the exact same millisecond.',
        options: [
          'Allow the last write to silently overwrite previous data without version validation',
          'Use version numbers/timestamps with optimistic locking or distributed locks, returning clear conflict resolution choices',
          'Queue all system requests sequentially through a single global thread',
          'Disable concurrency and restrict the entire system to one user at a time'
        ],
        correctIndex: 1,
        explanation: 'Optimistic locking using version columns detects stale updates and prevents data corruption in concurrent distributed systems.'
      },
      {
        id: 'q-12',
        difficulty: 'Hard',
        question: `What security hardening practice is critical when processing untrusted inputs with ${topicTitle}?`,
        scenario: 'Conducting an external penetration test and security audit before an enterprise release.',
        options: [
          'Relying solely on client-side form validation without server-side validation',
          'Enforcing strict server-side sanitization, parameterized queries, Content Security Policy (CSP), and role-based access checks',
          'Disabling CORS checks to allow requests from any third-party origin',
          'Storing unhashed authentication passwords in local storage cookies'
        ],
        correctIndex: 1,
        explanation: 'Defense in depth requires server-side validation, parameterized database execution, safe headers, and principle of least privilege.'
      }
    ]
  };
}

/**
 * Phase 6: Generate Topic Quiz / Assessment (12 Questions: 4 Easy, 4 Medium, 4 Hard)
 */
async function generateTopicAssessment(topicContext) {
  const { topicTitle, skillCategory, difficulty, targetRole } = topicContext;

  const prompt = `
You are an expert technical assessor and principal engineer at FutureMe.
Generate a comprehensive 12-question practice assessment for the topic:
Topic: "${topicTitle}"
Category: "${skillCategory || 'Software Engineering'}"
Difficulty: "${difficulty || 'Intermediate'}"
Target Role: "${targetRole || 'Software Engineer'}"

CRITICAL INSTRUCTIONS:
The assessment MUST contain EXACTLY 12 multiple choice questions in this strict difficulty distribution:
- Questions 1 to 4 MUST be "Easy": Fundamental concepts, syntax, definitions, core purpose, and terminology.
- Questions 5 to 8 MUST be "Medium": Practical implementation patterns, lifecycle, error handling, standard libraries, and testing.
- Questions 9 to 12 MUST be "Hard": Advanced edge cases, performance optimization, architectural trade-offs, concurrency, and security hardening.

Every question must be realistic, practical, and clear.
Respond with ONLY valid JSON adhering strictly to this schema:
{
  "topicTitle": "${topicTitle}",
  "skillName": string (the primary technical skill evaluated, e.g. "React", "Docker", "Node.js", "PostgreSQL", "TypeScript"),
  "passingScore": 70,
  "questions": [
    {
      "id": "q-1",
      "difficulty": "Easy",
      "question": string,
      "scenario": string (a short 1-sentence real-world developer context),
      "options": string[] (exactly 4 realistic options),
      "correctIndex": number (0 to 3),
      "explanation": string (concise explanation of why the correct option is right and the others are flawed)
    },
    ... (total exactly 12 questions: 4 Easy, 4 Medium, 4 Hard)
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
  getFallbackTopicContent,
};
