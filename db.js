const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Default initial onboarding sections for Admin to manage
const INITIAL_SECTIONS = [
  {
    key: 'personal_info',
    title: 'About Yourself',
    description: 'Introduce yourself with your professional title/headline and bio summary',
    stepOrder: 1,
    isEnabled: true,
    fieldsConfig: {
      headline: { label: 'Title / Headline', required: true, enabled: true },
      bio: { label: 'Bio / About', required: false, enabled: true },
    },
  },
  {
    key: 'academic_background',
    title: 'Academic Background',
    description: 'Your school, degree, field of study, timeline, and activities',
    stepOrder: 2,
    isEnabled: true,
    fieldsConfig: {
      school: { label: 'School', required: true, enabled: true },
      degree: { label: 'Degree', required: false, enabled: true },
      fieldOfStudy: { label: 'Field of Study', required: false, enabled: true },
      startDate: { label: 'Start Date', required: false, enabled: true },
      endDate: { label: 'End Date (or expected)', required: false, enabled: true },
      grade: { label: 'Grade / GPA', required: false, enabled: true },
      activities: { label: 'Activities and Societies', required: false, enabled: true },
    },
  },
  {
    key: 'skills',
    title: 'Skills & Proficiency',
    description: 'Select existing technical/soft skills and proficiency levels',
    stepOrder: 3,
    isEnabled: true,
    fieldsConfig: {
      minSkillsRequired: 1,
      allowCustomSkills: true,
      levels: ['Beginner', 'Intermediate', 'Advanced'],
    },
  },
  {
    key: 'experience',
    title: 'Experience',
    description: 'Internships, work experience, and employment history',
    stepOrder: 4,
    isEnabled: true,
    fieldsConfig: {
      experienceRequired: { label: 'Experience Required', required: false, enabled: true },
    },
  },
  {
    key: 'projects',
    title: 'Projects',
    description: 'Portfolio projects, technologies used, links, and certifications',
    stepOrder: 5,
    isEnabled: true,
    fieldsConfig: {
      projectsRequired: { label: 'Projects Required', required: false, enabled: true },
      certificationsRequired: { label: 'Certifications Required', required: false, enabled: true },
    },
  },
  {
    key: 'interests_goals',
    title: 'Interests, Preferences & Goals',
    description: 'Areas of interest, work preferences, and short/long term career goals',
    stepOrder: 6,
    isEnabled: true,
    fieldsConfig: {
      areasOfInterestRequired: true,
      workPreferencesRequired: true,
      shortTermGoalRequired: false,
      longTermGoalRequired: false,
      careerInterestsRequired: false,
    },
  },
];

// Default initial degrees for Admin catalog
const INITIAL_DEGREES = [
  'BS Computer Science',
];

// Default initial skills for Admin catalog
const INITIAL_SKILLS = [
  { name: 'React', category: 'Frontend' },
];

// Default initial catalog options
const INITIAL_OPTIONS = [
  // Work Preferences
  { type: 'WORK_PREFERENCE', label: 'Remote', displayOrder: 1 },
  { type: 'WORK_PREFERENCE', label: 'Onsite', displayOrder: 2 },
  { type: 'WORK_PREFERENCE', label: 'Hybrid', displayOrder: 3 },

  // Areas of Interest
  { type: 'AREA_OF_INTEREST', label: 'Web Technologies', displayOrder: 1 },

  // Career Interests
  { type: 'CAREER_INTEREST', label: 'Frontend Developer', displayOrder: 1 },
];

// Initialize database schema and verify Module 2 tables
const initDB = async () => {
  try {
    const client = await pool.connect();
    console.log('Connected to Neon PostgreSQL database.');

    // 1. Users table (Module 1)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        "firstName" VARCHAR(255) NOT NULL,
        "lastName" VARCHAR(255) DEFAULT '',
        email VARCHAR(255) UNIQUE NOT NULL,
        "passwordHash" VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'STUDENT' CHECK (role IN ('STUDENT', 'ADMIN')),
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS "firstName" VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastName" VARCHAR(255) DEFAULT '';
    `);

    // 2. Admin Managed: Onboarding Sections Configuration
    await client.query(`
      CREATE TABLE IF NOT EXISTS onboarding_sections (
        id VARCHAR(255) PRIMARY KEY,
        key VARCHAR(50) UNIQUE NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        "stepOrder" INTEGER NOT NULL,
        "isEnabled" BOOLEAN NOT NULL DEFAULT true,
        "fieldsConfig" JSONB NOT NULL DEFAULT '{}',
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 3. Admin Managed: Degrees Catalog
    await client.query(`
      CREATE TABLE IF NOT EXISTS catalog_degrees (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        department VARCHAR(255) DEFAULT 'Computing & Technology',
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "displayOrder" INTEGER DEFAULT 0,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 4. Admin Managed: Skills Catalog
    await client.query(`
      CREATE TABLE IF NOT EXISTS catalog_skills (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        category VARCHAR(100) NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 5. Admin Managed: Options Catalog (Interests, Goals, Preferences)
    await client.query(`
      CREATE TABLE IF NOT EXISTS catalog_options (
        id VARCHAR(255) PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        label VARCHAR(255) NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "displayOrder" INTEGER DEFAULT 0,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_type_label UNIQUE (type, label)
      );
    `);

    // 6. Student Profiles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_profiles (
        id VARCHAR(255) PRIMARY KEY,
        "userId" VARCHAR(255) UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        phone VARCHAR(30),
        headline VARCHAR(255),
        "studentStatus" VARCHAR(50) DEFAULT 'Currently Enrolled',
        "latestEducation" VARCHAR(100),
        bio TEXT,
        university VARCHAR(255),
        "currentDegree" VARCHAR(255),
        "semesterOrYear" VARCHAR(50),
        "graduationStatus" VARCHAR(50) DEFAULT 'In Progress',
        "expectedGraduationYear" INTEGER,
        "workPreferences" TEXT[] DEFAULT '{}',
        "areasOfInterest" TEXT[] DEFAULT '{}',
        "careerInterests" TEXT[] DEFAULT '{}',
        "shortTermGoal" TEXT,
        "longTermGoal" TEXT,
        "currentStepKey" VARCHAR(50) DEFAULT 'personal_info',
        "onboardingStep" INTEGER DEFAULT 1,
        "isOnboarded" BOOLEAN DEFAULT false,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS headline VARCHAR(255);
      ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS "currentStepKey" VARCHAR(50) DEFAULT 'personal_info';
      ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS school VARCHAR(255);
      ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS degree VARCHAR(255);
      ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS "fieldOfStudy" VARCHAR(255);
      ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS "startMonth" VARCHAR(30);
      ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS "startYear" INTEGER;
      ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS "endMonth" VARCHAR(30);
      ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS "endYear" INTEGER;
      ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS grade VARCHAR(50);
      ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS activities TEXT;
      CREATE INDEX IF NOT EXISTS idx_student_profiles_user_id ON student_profiles("userId");
    `);

    // 7. Student Skills
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_skills (
        id VARCHAR(255) PRIMARY KEY,
        "profileId" VARCHAR(255) NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
        "skillId" VARCHAR(255) REFERENCES catalog_skills(id) ON DELETE SET NULL,
        "customSkillName" VARCHAR(100),
        proficiency VARCHAR(20) NOT NULL CHECK (proficiency IN ('Beginner', 'Intermediate', 'Advanced')),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_student_skills_profile_id ON student_skills("profileId");
      ALTER TABLE student_skills DROP CONSTRAINT IF EXISTS "student_skills_skillId_fkey";
      ALTER TABLE student_skills ADD CONSTRAINT "student_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES catalog_skills(id) ON DELETE SET NULL;
    `);

    // 8. Student Projects
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_projects (
        id VARCHAR(255) PRIMARY KEY,
        "profileId" VARCHAR(255) NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        technologies TEXT[] DEFAULT '{}',
        "projectUrl" VARCHAR(500),
        "githubUrl" VARCHAR(500),
        "startDate" DATE,
        "endDate" DATE,
        "isCurrent" BOOLEAN DEFAULT false,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_student_projects_profile_id ON student_projects("profileId");
    `);

    // 9. Student Experiences
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_experiences (
        id VARCHAR(255) PRIMARY KEY,
        "profileId" VARCHAR(255) NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
        "companyName" VARCHAR(255) NOT NULL,
        "roleTitle" VARCHAR(255) NOT NULL,
        "employmentType" VARCHAR(50) DEFAULT 'Internship',
        location VARCHAR(255),
        "startDate" DATE,
        "endDate" DATE,
        "isCurrent" BOOLEAN DEFAULT false,
        description TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_student_experiences_profile_id ON student_experiences("profileId");
    `);

    // 10. Student Certifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_certifications (
        id VARCHAR(255) PRIMARY KEY,
        "profileId" VARCHAR(255) NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        type VARCHAR(50) DEFAULT 'Certification' CHECK (type IN ('Certification', 'Achievement')),
        issuer VARCHAR(255),
        "issueDate" DATE,
        "expiryDate" DATE,
        "credentialUrl" VARCHAR(500),
        "credentialId" VARCHAR(255),
        description TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_student_certifications_profile_id ON student_certifications("profileId");
    `);

    // 11. Student Skill Analyses (Phase 3)
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_skill_analyses (
        id VARCHAR(255) PRIMARY KEY,
        "profileId" VARCHAR(255) NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
        "targetRole" VARCHAR(255) NOT NULL,
        "matchScore" INTEGER NOT NULL DEFAULT 0,
        summary TEXT,
        strengths JSONB DEFAULT '[]'::jsonb,
        "proficientSkills" JSONB DEFAULT '[]'::jsonb,
        "skillsToUpgrade" JSONB DEFAULT '[]'::jsonb,
        "missingSkills" JSONB DEFAULT '[]'::jsonb,
        "recommendedFocusAreas" JSONB DEFAULT '[]'::jsonb,
        "estimatedTimeToReadiness" VARCHAR(100),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_student_skill_analyses_profile_id ON student_skill_analyses("profileId");
    `);

    // 12. Student Learning Paths (Phase 4)
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_learning_paths (
        id VARCHAR(255) PRIMARY KEY,
        "profileId" VARCHAR(255) NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
        "analysisId" VARCHAR(255) REFERENCES student_skill_analyses(id) ON DELETE SET NULL,
        "targetRole" VARCHAR(255) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        "totalDurationWeeks" INTEGER DEFAULT 12,
        milestones JSONB DEFAULT '[]'::jsonb,
        status VARCHAR(50) DEFAULT 'ACTIVE',
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_student_learning_paths_profile_id ON student_learning_paths("profileId");
    `);

    // 13. Topic Learning Materials & Resources (Phase 5)
    await client.query(`
      CREATE TABLE IF NOT EXISTS topic_learning_materials (
        id VARCHAR(255) PRIMARY KEY,
        "topicId" VARCHAR(255) NOT NULL,
        "topicTitle" VARCHAR(255) NOT NULL,
        "skillCategory" VARCHAR(100),
        overview TEXT,
        "keyConcepts" JSONB DEFAULT '[]'::jsonb,
        "detailedContent" TEXT,
        "codeExamples" JSONB DEFAULT '[]'::jsonb,
        "bestPractices" JSONB DEFAULT '[]'::jsonb,
        resources JSONB DEFAULT '[]'::jsonb,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_topic_learning_topicId UNIQUE ("topicId")
      );
      CREATE INDEX IF NOT EXISTS idx_topic_learning_topicId ON topic_learning_materials("topicId");
    `);

    // 14. Topic Quizzes & Assessments (Phase 6)
    await client.query(`
      CREATE TABLE IF NOT EXISTS topic_assessments (
        id VARCHAR(255) PRIMARY KEY,
        "topicId" VARCHAR(255) NOT NULL,
        "topicTitle" VARCHAR(255) NOT NULL,
        "skillName" VARCHAR(100),
        questions JSONB NOT NULL DEFAULT '[]'::jsonb,
        "passingScore" INTEGER DEFAULT 70,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_topic_assessment_topicId UNIQUE ("topicId")
      );
      CREATE INDEX IF NOT EXISTS idx_topic_assessment_topicId ON topic_assessments("topicId");
    `);

    // 15. Student Assessment Submissions & Progress (Phase 6)
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_assessment_submissions (
        id VARCHAR(255) PRIMARY KEY,
        "profileId" VARCHAR(255) NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
        "topicId" VARCHAR(255) NOT NULL,
        score INTEGER NOT NULL,
        passed BOOLEAN NOT NULL DEFAULT false,
        answers JSONB DEFAULT '[]'::jsonb,
        "skillUpgraded" VARCHAR(100),
        "newProficiency" VARCHAR(50),
        "submittedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_student_assessments_profile_id ON student_assessment_submissions("profileId");
      CREATE INDEX IF NOT EXISTS idx_student_assessments_topic_id ON student_assessment_submissions("topicId");
    `);

    // Seed default Onboarding Sections
    for (const sec of INITIAL_SECTIONS) {
      await client.query(
        `INSERT INTO onboarding_sections (id, key, title, description, "stepOrder", "isEnabled", "fieldsConfig", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (key) DO NOTHING`,
        [crypto.randomUUID(), sec.key, sec.title, sec.description, sec.stepOrder, sec.isEnabled, JSON.stringify(sec.fieldsConfig)]
      );
    }

    // Seed default Degrees Catalog
    for (let i = 0; i < INITIAL_DEGREES.length; i++) {
      const degName = INITIAL_DEGREES[i];
      await client.query(
        `INSERT INTO catalog_degrees (id, name, department, "isActive", "displayOrder", "createdAt")
         VALUES ($1, $2, 'Computing & Business', true, $3, NOW())
         ON CONFLICT (name) DO NOTHING`,
        [crypto.randomUUID(), degName, i + 1]
      );
    }

    // Seed default Skills Catalog
    for (const skill of INITIAL_SKILLS) {
      await client.query(
        `INSERT INTO catalog_skills (id, name, category, "isActive", "createdAt")
         VALUES ($1, $2, $3, true, NOW())
         ON CONFLICT (name) DO NOTHING`,
        [crypto.randomUUID(), skill.name, skill.category]
      );
    }

    // Seed default Catalog Options
    for (const opt of INITIAL_OPTIONS) {
      await client.query(
        `INSERT INTO catalog_options (id, type, label, "isActive", "displayOrder", "createdAt")
         VALUES ($1, $2, $3, true, $4, NOW())
         ON CONFLICT (type, label) DO NOTHING`,
        [crypto.randomUUID(), opt.type, opt.label, opt.displayOrder]
      );
    }

    console.log('Database initialized with Admin-managed Onboarding & Catalogs.');
    client.release();
  } catch (err) {
    console.error('Neon DB initialization error:', err.message);
  }
};

module.exports = {
  pool,
  initDB,
  query: (text, params) => pool.query(text, params),
};
