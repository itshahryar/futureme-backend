const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  analyzeSkillGaps,
  generateLearningPath,
  generateTopicContent,
  generateTopicAssessment,
} = require('../services/aiService');

/**
 * Helper to ensure student profile exists
 */
async function getOrCreateProfile(userId) {
  const existing = await db.query(
    'SELECT * FROM student_profiles WHERE "userId" = $1',
    [userId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  try {
    const profileId = crypto.randomUUID();
    const created = await db.query(
      `INSERT INTO student_profiles (
        id, "userId", "studentStatus", "currentStepKey", "onboardingStep", "isOnboarded", "createdAt", "updatedAt"
      ) VALUES ($1, $2, 'Currently Enrolled', 'personal_info', 1, false, NOW(), NOW())
      ON CONFLICT ("userId") DO UPDATE SET "updatedAt" = NOW()
      RETURNING *`,
      [profileId, userId]
    );

    return created.rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const retry = await db.query(
        'SELECT * FROM student_profiles WHERE "userId" = $1',
        [userId]
      );
      if (retry.rows.length > 0) {
        return retry.rows[0];
      }
    }
    throw err;
  }
}

/**
 * Helper to fetch complete student profile context
 */
async function getStudentProfileContext(userId) {
  const profile = await getOrCreateProfile(userId);

  // Fetch skills
  const skillsRes = await db.query(
    `SELECT ss.id, ss."skillId", ss."customSkillName", ss.proficiency,
            COALESCE(s.name, ss."customSkillName") AS name,
            COALESCE(s.category, 'Custom') AS category
     FROM student_skills ss
     LEFT JOIN catalog_skills s ON ss."skillId" = s.id
     WHERE ss."profileId" = $1
     ORDER BY ss."createdAt" ASC`,
    [profile.id]
  );

  // Fetch projects
  const projectsRes = await db.query(
    `SELECT id, title, description, technologies, "projectUrl", "githubUrl"
     FROM student_projects
     WHERE "profileId" = $1
     ORDER BY "createdAt" DESC`,
    [profile.id]
  );

  // Fetch experiences
  const experiencesRes = await db.query(
    `SELECT id, "companyName", "roleTitle", "employmentType", location,
            "startDate", "endDate", "isCurrent", description
     FROM student_experiences
     WHERE "profileId" = $1
     ORDER BY "startDate" DESC NULLS LAST, "createdAt" DESC`,
    [profile.id]
  );

  // Fetch certifications
  const certsRes = await db.query(
    `SELECT id, title, type, issuer, "issueDate"
     FROM student_certifications
     WHERE "profileId" = $1
     ORDER BY "issueDate" DESC NULLS LAST, "createdAt" DESC`,
    [profile.id]
  );

  return {
    profile,
    skills: skillsRes.rows,
    projects: projectsRes.rows,
    experiences: experiencesRes.rows,
    certifications: certsRes.rows,
  };
}

/**
 * Helper to extract effective target role
 */
function resolveTargetRole(customRole, profile) {
  if (customRole && typeof customRole === 'string' && customRole.trim()) {
    return customRole.trim();
  }

  if (Array.isArray(profile.careerInterests) && profile.careerInterests.length > 0) {
    const first = profile.careerInterests[0];
    if (typeof first === 'string' && first.trim()) return first.trim();
    if (first && typeof first === 'object' && first.title) return first.title.trim();
  }

  if (Array.isArray(profile.areasOfInterest) && profile.areasOfInterest.length > 0) {
    const first = profile.areasOfInterest[0];
    if (typeof first === 'string' && first.trim()) return first.trim();
  }

  return 'Software Engineer';
}

// ==========================================
// Phase 3: AI SKILL GAP ANALYSIS ENDPOINTS
// ==========================================

/**
 * GET /api/ai/skill-analysis
 * Retrieves the latest skill analysis for current student
 */
router.get('/skill-analysis', requireAuth, async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);
    const { targetRole } = req.query;

    let analysisRes;
    if (targetRole && typeof targetRole === 'string' && targetRole.trim()) {
      analysisRes = await db.query(
        `SELECT * FROM student_skill_analyses
         WHERE "profileId" = $1 AND LOWER("targetRole") = LOWER($2)
         ORDER BY "createdAt" DESC
         LIMIT 1`,
        [profile.id, targetRole.trim()]
      );
    } else {
      analysisRes = await db.query(
        `SELECT * FROM student_skill_analyses
         WHERE "profileId" = $1
         ORDER BY "createdAt" DESC
         LIMIT 1`,
        [profile.id]
      );
    }

    if (analysisRes.rows.length === 0) {
      return res.json({
        exists: false,
        analysis: null,
        availableRoles: profile.careerInterests || [],
      });
    }

    return res.json({
      exists: true,
      analysis: analysisRes.rows[0],
      availableRoles: profile.careerInterests || [],
    });
  } catch (err) {
    console.error('Error fetching skill analysis:', err);
    return res.status(500).json({ error: 'Failed to fetch skill analysis' });
  }
});

/**
 * POST /api/ai/skill-analysis/generate
 * Runs AI skill gap audit for current student profile against target career benchmark
 */
router.post('/skill-analysis/generate', requireAuth, async (req, res) => {
  try {
    const context = await getStudentProfileContext(req.user.id);
    if (!context || !context.profile) {
      return res.status(404).json({ error: 'Student profile not found. Please complete profile first.' });
    }

    const targetRole = resolveTargetRole(req.body.targetRole, context.profile);

    const profileContextForAI = {
      targetRole,
      degree: context.profile.currentDegree || context.profile.degree || 'Computer Science',
      university: context.profile.university || context.profile.school || 'University',
      semesterOrYear: context.profile.semesterOrYear || 'Enrolled',
      skills: context.skills || [],
      projects: context.projects || [],
      experiences: context.experiences || [],
      certifications: context.certifications || [],
      careerInterests: context.profile.careerInterests || [],
      areasOfInterest: context.profile.areasOfInterest || [],
      shortTermGoal: context.profile.shortTermGoal || '',
      longTermGoal: context.profile.longTermGoal || '',
    };

    // Call AI Service
    const aiResult = await analyzeSkillGaps(profileContextForAI);

    // Save result to PostgreSQL
    const analysisId = crypto.randomUUID();
    const insertRes = await db.query(
      `INSERT INTO student_skill_analyses (
        id, "profileId", "targetRole", "matchScore", summary,
        strengths, "proficientSkills", "skillsToUpgrade", "missingSkills",
        "recommendedFocusAreas", "estimatedTimeToReadiness",
        "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING *`,
      [
        analysisId,
        context.profile.id,
        aiResult.targetRole || targetRole,
        Math.round(aiResult.matchScore || 0),
        aiResult.summary || '',
        JSON.stringify(aiResult.strengths || []),
        JSON.stringify(aiResult.proficientSkills || []),
        JSON.stringify(aiResult.skillsToUpgrade || []),
        JSON.stringify(aiResult.missingSkills || []),
        JSON.stringify(aiResult.recommendedFocusAreas || []),
        aiResult.estimatedTimeToReadiness || '8 - 12 weeks',
      ]
    );

    return res.status(201).json({
      success: true,
      analysis: insertRes.rows[0],
      message: 'AI Skill Analysis generated successfully',
    });
  } catch (err) {
    console.error('Error generating skill analysis:', err);
    return res.status(500).json({ error: 'Failed to generate skill analysis', details: err.message });
  }
});

// ==========================================
// Phase 4: AI LEARNING PATH ROADMAP ENDPOINTS
// ==========================================

/**
 * GET /api/ai/learning-path
 * Retrieves the active learning roadmap for current student
 */
router.get('/learning-path', requireAuth, async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);
    const profileId = profile.id;
    const { targetRole } = req.query;

    let pathRes;
    if (targetRole && typeof targetRole === 'string' && targetRole.trim()) {
      pathRes = await db.query(
        `SELECT * FROM student_learning_paths
         WHERE "profileId" = $1 AND LOWER("targetRole") = LOWER($2)
         ORDER BY "createdAt" DESC
         LIMIT 1`,
        [profileId, targetRole.trim()]
      );
    } else {
      pathRes = await db.query(
        `SELECT * FROM student_learning_paths
         WHERE "profileId" = $1
         ORDER BY "createdAt" DESC
         LIMIT 1`,
        [profileId]
      );
    }

    if (pathRes.rows.length === 0) {
      return res.json({
        exists: false,
        learningPath: null,
      });
    }

    return res.json({
      exists: true,
      learningPath: pathRes.rows[0],
    });
  } catch (err) {
    console.error('Error fetching learning path:', err);
    return res.status(500).json({ error: 'Failed to fetch learning path' });
  }
});

/**
 * POST /api/ai/learning-path/generate
 * Generates or regenerates an AI modular learning roadmap
 */
router.post('/learning-path/generate', requireAuth, async (req, res) => {
  try {
    const context = await getStudentProfileContext(req.user.id);
    if (!context || !context.profile) {
      return res.status(404).json({ error: 'Student profile not found. Please complete profile first.' });
    }

    const { analysisId, targetRole: customRole } = req.body;

    // Fetch existing skill analysis
    let analysis = null;
    if (analysisId) {
      const aRes = await db.query(
        'SELECT * FROM student_skill_analyses WHERE id = $1 AND "profileId" = $2',
        [analysisId, context.profile.id]
      );
      if (aRes.rows.length > 0) analysis = aRes.rows[0];
    }

    if (!analysis) {
      const latestRes = await db.query(
        'SELECT * FROM student_skill_analyses WHERE "profileId" = $1 ORDER BY "createdAt" DESC LIMIT 1',
        [context.profile.id]
      );
      if (latestRes.rows.length > 0) analysis = latestRes.rows[0];
    }

    const effectiveTargetRole = resolveTargetRole(customRole || analysis?.targetRole, context.profile);

    // Call AI Learning Path generator
    const profileContextForAI = {
      targetRole: effectiveTargetRole,
      degree: context.profile.currentDegree || context.profile.degree || 'Computer Science',
      skills: context.skills || [],
      shortTermGoal: context.profile.shortTermGoal || '',
      longTermGoal: context.profile.longTermGoal || '',
    };

    const aiPathResult = await generateLearningPath(profileContextForAI, analysis);

    // Ensure subtopics have completed flag
    const formattedMilestones = (aiPathResult.milestones || []).map((m, mIdx) => ({
      ...m,
      milestoneNumber: m.milestoneNumber || mIdx + 1,
      topics: (m.topics || []).map((t, tIdx) => ({
        ...t,
        id: t.id || `topic-${m.milestoneNumber || mIdx + 1}-${tIdx + 1}`,
        subtopics: (t.subtopics || []).map((sub, sIdx) => ({
          ...sub,
          id: sub.id || `sub-${m.milestoneNumber || mIdx + 1}-${tIdx + 1}-${sIdx + 1}`,
          isCompleted: false,
        })),
      })),
    }));

    const pathId = crypto.randomUUID();
    const insertRes = await db.query(
      `INSERT INTO student_learning_paths (
        id, "profileId", "analysisId", "targetRole", title, description,
        "totalDurationWeeks", milestones, status, "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', NOW(), NOW())
      RETURNING *`,
      [
        pathId,
        context.profile.id,
        analysis?.id || null,
        effectiveTargetRole,
        aiPathResult.title || `${effectiveTargetRole} Accelerated Mastery Path`,
        aiPathResult.description || `Structured milestone roadmap tailored for ${effectiveTargetRole}.`,
        aiPathResult.totalDurationWeeks || 12,
        JSON.stringify(formattedMilestones),
      ]
    );

    return res.status(201).json({
      success: true,
      learningPath: insertRes.rows[0],
      message: 'AI Learning Roadmap generated successfully',
    });
  } catch (err) {
    console.error('Error generating learning path:', err);
    return res.status(500).json({ error: 'Failed to generate learning path', details: err.message });
  }
});

/**
 * PATCH /api/ai/learning-path/:pathId/subtopic-status
 * Toggle completion status for a subtopic in the learning path
 */
router.patch('/learning-path/:pathId/subtopic-status', requireAuth, async (req, res) => {
  try {
    const { pathId } = req.params;
    const { subtopicId, completed } = req.body;

    if (!subtopicId) {
      return res.status(400).json({ error: 'subtopicId is required' });
    }

    const pathRes = await db.query(
      `SELECT lp.* FROM student_learning_paths lp
       JOIN student_profiles sp ON lp."profileId" = sp.id
       WHERE lp.id = $1 AND sp."userId" = $2`,
      [pathId, req.user.id]
    );

    if (pathRes.rows.length === 0) {
      return res.status(404).json({ error: 'Learning path not found' });
    }

    const pathRecord = pathRes.rows[0];
    const milestones = typeof pathRecord.milestones === 'string'
      ? JSON.parse(pathRecord.milestones)
      : (pathRecord.milestones || []);

    let found = false;
    for (const m of milestones) {
      for (const t of (m.topics || [])) {
        for (const sub of (t.subtopics || [])) {
          if (sub.id === subtopicId) {
            sub.isCompleted = Boolean(completed);
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (found) break;
    }

    const updatedRes = await db.query(
      `UPDATE student_learning_paths
       SET milestones = $1, "updatedAt" = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(milestones), pathId]
    );

    return res.json({
      success: true,
      learningPath: updatedRes.rows[0],
    });
  } catch (err) {
    console.error('Error updating subtopic status:', err);
    return res.status(500).json({ error: 'Failed to update subtopic status' });
  }
});

// ==========================================
// Phase 5: TOPIC LEARNING CONTENT & RESOURCES
// ==========================================

/**
 * POST /api/ai/topic/:topicId/content
 * Retrieves or dynamically generates in-depth learning materials and curated resources for a topic
 */
router.post('/topic/:topicId/content', requireAuth, async (req, res) => {
  try {
    const { topicId } = req.params;
    const { topicTitle, skillCategory, difficulty, targetRole, subtopics = [] } = req.body;

    // Check cache in database first
    const existingRes = await db.query(
      'SELECT * FROM topic_learning_materials WHERE "topicId" = $1',
      [topicId]
    );

    if (existingRes.rows.length > 0) {
      return res.json({
        cached: true,
        material: existingRes.rows[0],
      });
    }

    // Call AI Service
    const aiContent = await generateTopicContent({
      topicTitle: topicTitle || 'Core Concepts',
      skillCategory: skillCategory || 'Software Engineering',
      difficulty: difficulty || 'Intermediate',
      targetRole: targetRole || 'Software Engineer',
      subtopics,
    });

    const materialId = crypto.randomUUID();
    const insertRes = await db.query(
      `INSERT INTO topic_learning_materials (
        id, "topicId", "topicTitle", "skillCategory", overview,
        "keyConcepts", "detailedContent", "codeExamples", "bestPractices",
        resources, "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *`,
      [
        materialId,
        topicId,
        aiContent.topicTitle || topicTitle,
        aiContent.skillCategory || skillCategory || 'Core',
        aiContent.overview || '',
        JSON.stringify(aiContent.keyConcepts || []),
        aiContent.detailedContent || '',
        JSON.stringify(aiContent.codeExamples || []),
        JSON.stringify(aiContent.bestPractices || []),
        JSON.stringify(aiContent.resources || []),
      ]
    );

    return res.status(201).json({
      cached: false,
      material: insertRes.rows[0],
    });
  } catch (err) {
    console.error('Error fetching topic content:', err);
    return res.status(500).json({ error: 'Failed to load topic learning materials' });
  }
});

// ==========================================
// Phase 6: TOPIC QUIZZES, ASSESSMENTS & SKILL UPDATES
// ==========================================

/**
 * POST /api/ai/topic/:topicId/assessment
 * Retrieves or generates practical assessment questions for a topic
 */
router.post('/topic/:topicId/assessment', requireAuth, async (req, res) => {
  try {
    const { topicId } = req.params;
    const { topicTitle, skillCategory, difficulty, targetRole } = req.body;

    // Check cache in database first
    const existingRes = await db.query(
      'SELECT * FROM topic_assessments WHERE "topicId" = $1',
      [topicId]
    );

    if (existingRes.rows.length > 0) {
      const assessment = existingRes.rows[0];
      // Do not reveal correctIndex on initial fetch so student cannot cheat
      const questionsWithoutAnswers = (assessment.questions || []).map((q) => ({
        id: q.id,
        question: q.question,
        scenario: q.scenario,
        options: q.options,
      }));

      return res.json({
        cached: true,
        assessment: {
          id: assessment.id,
          topicId: assessment.topicId,
          topicTitle: assessment.topicTitle,
          skillName: assessment.skillName,
          passingScore: assessment.passingScore,
          questions: questionsWithoutAnswers,
        },
      });
    }

    // Call AI Service
    const aiAssessment = await generateTopicAssessment({
      topicTitle: topicTitle || 'Core Concepts',
      skillCategory: skillCategory || 'Software Engineering',
      difficulty: difficulty || 'Intermediate',
      targetRole: targetRole || 'Software Engineer',
    });

    const assessmentId = crypto.randomUUID();
    const insertRes = await db.query(
      `INSERT INTO topic_assessments (
        id, "topicId", "topicTitle", "skillName", questions, "passingScore", "createdAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *`,
      [
        assessmentId,
        topicId,
        aiAssessment.topicTitle || topicTitle,
        aiAssessment.skillName || topicTitle.split(' ')[0] || 'Software Engineering',
        JSON.stringify(aiAssessment.questions || []),
        aiAssessment.passingScore || 70,
      ]
    );

    const saved = insertRes.rows[0];
    const questionsWithoutAnswers = (saved.questions || []).map((q) => ({
      id: q.id,
      question: q.question,
      scenario: q.scenario,
      options: q.options,
    }));

    return res.status(201).json({
      cached: false,
      assessment: {
        id: saved.id,
        topicId: saved.topicId,
        topicTitle: saved.topicTitle,
        skillName: saved.skillName,
        passingScore: saved.passingScore,
        questions: questionsWithoutAnswers,
      },
    });
  } catch (err) {
    console.error('Error generating topic assessment:', err);
    return res.status(500).json({ error: 'Failed to generate topic assessment' });
  }
});

/**
 * POST /api/ai/topic/:topicId/submit-assessment
 * Scores the student's answers, records submission, marks progress, and unlocks skill upgrade
 */
router.post('/topic/:topicId/submit-assessment', requireAuth, async (req, res) => {
  try {
    const { topicId } = req.params;
    const { answers = {}, pathId } = req.body;

    const profile = await getOrCreateProfile(req.user.id);

    // Fetch assessment with correct answers
    const assessmentRes = await db.query(
      'SELECT * FROM topic_assessments WHERE "topicId" = $1',
      [topicId]
    );

    if (assessmentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Assessment not found for this topic' });
    }

    const assessment = assessmentRes.rows[0];
    const questions = assessment.questions || [];

    let correctCount = 0;
    const results = questions.map((q) => {
      const selected = answers[q.id];
      const isCorrect = selected === q.correctIndex;
      if (isCorrect) correctCount++;
      return {
        id: q.id,
        question: q.question,
        selectedOption: selected,
        correctOption: q.correctIndex,
        isCorrect,
        explanation: q.explanation,
      };
    });

    const score = questions.length > 0
      ? Math.round((correctCount / questions.length) * 100)
      : 0;

    const passed = score >= (assessment.passingScore || 70);

    // Record submission
    const submissionId = crypto.randomUUID();
    await db.query(
      `INSERT INTO student_assessment_submissions (
        id, "profileId", "topicId", score, passed, answers, "skillUpgraded", "newProficiency", "submittedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        submissionId,
        profile.id,
        topicId,
        score,
        passed,
        JSON.stringify(answers),
        passed ? assessment.skillName : null,
        passed ? 'Intermediate' : null,
      ]
    );

    // If passed and learning path ID provided, automatically mark all subtopics in this topic as completed!
    if (passed && pathId) {
      const pathRes = await db.query(
        'SELECT milestones FROM student_learning_paths WHERE id = $1 AND "profileId" = $2',
        [pathId, profile.id]
      );
      if (pathRes.rows.length > 0) {
        const milestones = pathRes.rows[0].milestones || [];
        milestones.forEach((m) => {
          (m.topics || []).forEach((t) => {
            if (t.id === topicId) {
              (t.subtopics || []).forEach((sub) => {
                sub.isCompleted = true;
              });
            }
          });
        });
        await db.query(
          'UPDATE student_learning_paths SET milestones = $1, "updatedAt" = NOW() WHERE id = $2',
          [JSON.stringify(milestones), pathId]
        );
      }
    }

    return res.json({
      success: true,
      score,
      passed,
      passingScore: assessment.passingScore || 70,
      totalQuestions: questions.length,
      correctCount,
      skillName: assessment.skillName,
      results,
    });
  } catch (err) {
    console.error('Error submitting assessment:', err);
    return res.status(500).json({ error: 'Failed to process assessment submission' });
  }
});

/**
 * POST /api/ai/update-learned-skill
 * Direct User Skill Update (answering: "from where user will say i have done this skill")
 * Called either directly by the user or upon passing an assessment
 */
router.post('/update-learned-skill', requireAuth, async (req, res) => {
  try {
    const { skillName, proficiency = 'Intermediate' } = req.body;

    if (!skillName || !skillName.trim()) {
      return res.status(400).json({ error: 'skillName is required' });
    }

    const cleanSkillName = skillName.trim();
    const cleanProf = ['Beginner', 'Intermediate', 'Advanced'].includes(proficiency)
      ? proficiency
      : 'Intermediate';

    const profile = await getOrCreateProfile(req.user.id);

    // Check if skill already exists in student_skills
    const existingSkillRes = await db.query(
      `SELECT ss.id, ss."skillId", ss."customSkillName", ss.proficiency,
              COALESCE(s.name, ss."customSkillName") AS name
       FROM student_skills ss
       LEFT JOIN catalog_skills s ON ss."skillId" = s.id
       WHERE ss."profileId" = $1 AND (
         LOWER(COALESCE(s.name, '')) = LOWER($2) OR
         LOWER(COALESCE(ss."customSkillName", '')) = LOWER($2)
       )
       LIMIT 1`,
      [profile.id, cleanSkillName]
    );

    if (existingSkillRes.rows.length > 0) {
      // Update existing skill proficiency
      const existingId = existingSkillRes.rows[0].id;
      await db.query(
        'UPDATE student_skills SET proficiency = $1 WHERE id = $2',
        [cleanProf, existingId]
      );
    } else {
      // Check if matches catalog skill
      const catCheck = await db.query(
        'SELECT id FROM catalog_skills WHERE LOWER(name) = LOWER($1) LIMIT 1',
        [cleanSkillName]
      );

      const newSkillId = crypto.randomUUID();
      if (catCheck.rows.length > 0) {
        await db.query(
          `INSERT INTO student_skills (id, "profileId", "skillId", "customSkillName", proficiency, "createdAt")
           VALUES ($1, $2, $3, NULL, $4, NOW())`,
          [newSkillId, profile.id, catCheck.rows[0].id, cleanProf]
        );
      } else {
        await db.query(
          `INSERT INTO student_skills (id, "profileId", "skillId", "customSkillName", proficiency, "createdAt")
           VALUES ($1, $2, NULL, $3, $4, NOW())`,
          [newSkillId, profile.id, cleanSkillName, cleanProf]
        );
      }
    }

    // Update profile's updatedAt
    await db.query('UPDATE student_profiles SET "updatedAt" = NOW() WHERE id = $1', [profile.id]);

    // Recalculate / Update latest student_skill_analyses in database
    const latestAnalysisRes = await db.query(
      'SELECT * FROM student_skill_analyses WHERE "profileId" = $1 ORDER BY "createdAt" DESC LIMIT 1',
      [profile.id]
    );

    let updatedAnalysis = null;
    if (latestAnalysisRes.rows.length > 0) {
      const a = latestAnalysisRes.rows[0];
      const proficient = typeof a.proficientSkills === 'string' ? JSON.parse(a.proficientSkills) : (a.proficientSkills || []);
      const upgrade = typeof a.skillsToUpgrade === 'string' ? JSON.parse(a.skillsToUpgrade) : (a.skillsToUpgrade || []);
      const missing = typeof a.missingSkills === 'string' ? JSON.parse(a.missingSkills) : (a.missingSkills || []);

      // Filter out from missing & upgrade
      const newMissing = missing.filter((m) => m.name?.toLowerCase() !== cleanSkillName.toLowerCase());
      const newUpgrade = upgrade.filter((u) => u.name?.toLowerCase() !== cleanSkillName.toLowerCase());

      // Add to proficient if not already there
      const existingProfIndex = proficient.findIndex((p) => p.name?.toLowerCase() === cleanSkillName.toLowerCase());
      if (existingProfIndex >= 0) {
        proficient[existingProfIndex].currentLevel = cleanProf;
      } else {
        proficient.push({
          name: cleanSkillName,
          currentLevel: cleanProf,
          requiredLevel: cleanProf,
          status: 'PROFICIENT',
          reasoning: `Demonstrated proficiency in ${cleanSkillName} through coursework & assessments.`,
        });
      }

      // Increment match score proportionally
      const newScore = Math.min(100, Math.round(a.matchScore + 8));

      const updatedAnalysisRes = await db.query(
        `UPDATE student_skill_analyses
         SET "matchScore" = $1, "proficientSkills" = $2, "skillsToUpgrade" = $3,
             "missingSkills" = $4, "updatedAt" = NOW()
         WHERE id = $5
         RETURNING *`,
        [
          newScore,
          JSON.stringify(proficient),
          JSON.stringify(newUpgrade),
          JSON.stringify(newMissing),
          a.id,
        ]
      );
      updatedAnalysis = updatedAnalysisRes.rows[0];
    }

    return res.json({
      success: true,
      message: `Skill "${cleanSkillName}" successfully updated to ${cleanProf}!`,
      updatedSkill: { name: cleanSkillName, proficiency: cleanProf },
      analysis: updatedAnalysis,
    });
  } catch (err) {
    console.error('Error updating learned skill:', err);
    return res.status(500).json({ error: 'Failed to update learned skill' });
  }
});

/**
 * GET /api/ai/my-assessments
 * Retrieves all quiz submissions for current student
 */
router.get('/my-assessments', requireAuth, async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);
    const submissionsRes = await db.query(
      `SELECT sub.*, ta."topicTitle"
       FROM student_assessment_submissions sub
       LEFT JOIN topic_assessments ta ON sub."topicId" = ta."topicId"
       WHERE sub."profileId" = $1
       ORDER BY sub."submittedAt" DESC`,
      [profile.id]
    );

    return res.json({
      submissions: submissionsRes.rows,
    });
  } catch (err) {
    console.error('Error fetching submissions:', err);
    return res.status(500).json({ error: 'Failed to fetch assessment history' });
  }
});

module.exports = router;
