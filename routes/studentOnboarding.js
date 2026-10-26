const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

/**
 * Helper to ensure student profile exists
 */
const getOrCreateProfile = async (userId) => {
  const existing = await db.query(
    'SELECT * FROM student_profiles WHERE "userId" = $1',
    [userId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const profileId = crypto.randomUUID();
  const created = await db.query(
    `INSERT INTO student_profiles (
      id, "userId", "studentStatus", "currentStepKey", "onboardingStep", "isOnboarded", "createdAt", "updatedAt"
    ) VALUES ($1, $2, 'Currently Enrolled', 'personal_info', 1, false, NOW(), NOW())
    RETURNING *`,
    [profileId, userId]
  );

  return created.rows[0];
};

/**
 * Calculate profile completion percentage based on data completeness
 */
const calculateCompletion = (profile, skills, projects, experiences, certifications) => {
  let score = 0;
  // About Yourself (20%)
  if (profile.headline) score += 10;
  if (profile.bio) score += 10;

  // Academic Background (20%)
  if (profile.school || profile.university) score += 10;
  if (profile.degree || profile.currentDegree) score += 10;

  // Skills (20%)
  if (skills && skills.length > 0) score += 20;

  // Projects & Experience (20%)
  if (projects && projects.length > 0) score += 10;
  if ((experiences && experiences.length > 0) || (certifications && certifications.length > 0)) score += 10;

  // Interests, Preferences & Goals (20%)
  if (profile.workPreferences && profile.workPreferences.length > 0) score += 7;
  if (profile.areasOfInterest && profile.areasOfInterest.length > 0) score += 7;
  if (profile.shortTermGoal || profile.longTermGoal) score += 6;

  return Math.min(100, score);
};

/**
 * GET /api/onboarding/config
 * Dynamic configuration for student onboarding based on Admin configuration
 */
router.get('/config', async (req, res) => {
  try {
    // Only return ENABLED sections ordered by stepOrder
    const sectionsRes = await db.query(
      `SELECT id, key, title, description, "stepOrder", "fieldsConfig"
       FROM onboarding_sections
       WHERE "isEnabled" = true
       ORDER BY "stepOrder" ASC`
    );

    // Only return ACTIVE degrees
    const degreesRes = await db.query(
      `SELECT id, name, department
       FROM catalog_degrees
       WHERE "isActive" = true
       ORDER BY "displayOrder" ASC, name ASC`
    );

    // Only return ACTIVE skills
    const skillsRes = await db.query(
      `SELECT id, name, category
       FROM catalog_skills
       WHERE "isActive" = true
       ORDER BY category ASC, name ASC`
    );

    // Only return ACTIVE options
    const optionsRes = await db.query(
      `SELECT id, type, label
       FROM catalog_options
       WHERE "isActive" = true
       ORDER BY type ASC, "displayOrder" ASC, label ASC`
    );

    // Group options by type
    const groupedOptions = optionsRes.rows.reduce((acc, row) => {
      acc[row.type] = acc[row.type] || [];
      acc[row.type].push(row.label);
      return acc;
    }, {});

    return res.json({
      sections: sectionsRes.rows,
      degrees: degreesRes.rows.map((d) => d.name),
      skills: skillsRes.rows,
      workPreferences: groupedOptions['WORK_PREFERENCE'] || ['Remote', 'Onsite', 'Hybrid'],
      areasOfInterest: groupedOptions['AREA_OF_INTEREST'] || [],
      careerInterests: groupedOptions['CAREER_INTEREST'] || [],
      educationLevels: groupedOptions['EDUCATION_LEVEL'] || [
        'High School / Matriculation',
        'Intermediate / A-Levels / FSc',
        'Undergraduate Degree',
        'Postgraduate Degree / Masters',
      ],
      studentStatuses: groupedOptions['STUDENT_STATUS'] || [
        'Currently Enrolled',
        'Recent Graduate',
        'On Leave / Gap Year',
      ],
      semesters: [
        'Semester 1', 'Semester 2', 'Semester 3', 'Semester 4',
        'Semester 5', 'Semester 6', 'Semester 7', 'Semester 8',
        'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Graduated'
      ],
      graduationStatuses: ['In Progress', 'Completed', 'Expected Soon'],
      proficiencyLevels: ['Beginner', 'Intermediate', 'Advanced'],
    });
  } catch (err) {
    console.error('Error fetching onboarding config:', err);
    return res.status(500).json({ error: 'Failed to load onboarding configuration' });
  }
});

/**
 * GET /api/profile/me
 * Retrieves student profile with relations and onboarding state
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);

    // Fetch user details
    const userRes = await db.query(
      'SELECT id, "firstName", "lastName", email, role FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userRes.rows[0];

    // Fetch student skills
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

    // Fetch student projects
    const projectsRes = await db.query(
      `SELECT id, title, description, technologies, "projectUrl", "githubUrl",
              "startDate", "endDate", "isCurrent", "createdAt"
       FROM student_projects
       WHERE "profileId" = $1
       ORDER BY "createdAt" DESC`,
      [profile.id]
    );

    // Fetch student experiences
    const experiencesRes = await db.query(
      `SELECT id, "companyName", "roleTitle", "employmentType", location,
              "startDate", "endDate", "isCurrent", description, "createdAt"
       FROM student_experiences
       WHERE "profileId" = $1
       ORDER BY "startDate" DESC NULLS LAST, "createdAt" DESC`,
      [profile.id]
    );

    // Fetch student certifications
    const certsRes = await db.query(
      `SELECT id, title, type, issuer, "issueDate", "expiryDate",
              "credentialUrl", "credentialId", description, "createdAt"
       FROM student_certifications
       WHERE "profileId" = $1
       ORDER BY "issueDate" DESC NULLS LAST, "createdAt" DESC`,
      [profile.id]
    );

    const completionPercentage = calculateCompletion(
      profile,
      skillsRes.rows,
      projectsRes.rows,
      experiencesRes.rows,
      certsRes.rows
    );

    return res.json({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: [user.firstName, user.lastName].filter(Boolean).join(' '),
        email: user.email,
        role: user.role,
      },
      profile: {
        id: profile.id,
        phone: profile.phone || '',
        headline: profile.headline || '',
        bio: profile.bio || '',
        school: profile.school || profile.university || '',
        degree: profile.degree || profile.currentDegree || '',
        fieldOfStudy: profile.fieldOfStudy || '',
        startMonth: profile.startMonth || '',
        startYear: profile.startYear || '',
        endMonth: profile.endMonth || '',
        endYear: profile.endYear || profile.expectedGraduationYear || '',
        grade: profile.grade || '',
        activities: profile.activities || '',
        university: profile.school || profile.university || '',
        currentDegree: profile.degree || profile.currentDegree || '',
        semesterOrYear: profile.semesterOrYear || '',
        graduationStatus: profile.graduationStatus || 'In Progress',
        expectedGraduationYear: profile.endYear || profile.expectedGraduationYear || new Date().getFullYear(),
        workPreferences: profile.workPreferences || [],
        areasOfInterest: profile.areasOfInterest || [],
        careerInterests: profile.careerInterests || [],
        shortTermGoal: profile.shortTermGoal || '',
        longTermGoal: profile.longTermGoal || '',
        currentStepKey: profile.currentStepKey || 'personal_info',
        onboardingStep: profile.onboardingStep || 1,
        isOnboarded: profile.isOnboarded || false,
        completionPercentage,
      },
      skills: skillsRes.rows,
      projects: projectsRes.rows,
      experiences: experiencesRes.rows,
      certifications: certsRes.rows,
    });
  } catch (err) {
    console.error('Error fetching student profile:', err);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

/**
 * PUT /api/onboarding/save-step
 * Dynamic step saving according to section key
 */
router.put('/save-step', requireAuth, async (req, res) => {
  try {
    const { sectionKey, data, nextStepKey } = req.body;
    if (!sectionKey || !data) {
      return res.status(400).json({ error: 'Section key and data are required' });
    }

    const profile = await getOrCreateProfile(req.user.id);

    if (sectionKey === 'personal_info') {
      const { firstName, lastName, phone, headline, bio } = data;

      if (firstName !== undefined || lastName !== undefined) {
        await db.query(
          `UPDATE users
           SET "firstName" = COALESCE($1, "firstName"),
               "lastName" = COALESCE($2, "lastName"),
               "updatedAt" = NOW()
           WHERE id = $3`,
          [
            firstName !== undefined ? firstName.trim() : null,
            lastName !== undefined ? lastName.trim() : null,
            req.user.id,
          ]
        );
      }

      await db.query(
        `UPDATE student_profiles
         SET phone = $1, headline = $2, bio = $3,
             "currentStepKey" = COALESCE($4, "currentStepKey"),
             "updatedAt" = NOW()
         WHERE id = $5`,
        [phone || null, headline || null, bio || null, nextStepKey || null, profile.id]
      );
    } else if (sectionKey === 'academic_background') {
      const {
        school,
        degree,
        fieldOfStudy,
        startMonth,
        startYear,
        endMonth,
        endYear,
        grade,
        activities,
        university,
        currentDegree,
        expectedGraduationYear,
      } = data;

      const finalSchool = school || university || null;
      const finalDegree = degree || currentDegree || null;
      const parsedStartYear = startYear ? parseInt(startYear, 10) : null;
      const parsedEndYear = endYear
        ? parseInt(endYear, 10)
        : expectedGraduationYear
        ? parseInt(expectedGraduationYear, 10)
        : null;

      await db.query(
        `UPDATE student_profiles
         SET school = $1, degree = $2, "fieldOfStudy" = $3,
             "startMonth" = $4, "startYear" = $5,
             "endMonth" = $6, "endYear" = $7,
             grade = $8, activities = $9,
             university = COALESCE($1, university),
             "currentDegree" = COALESCE($2, "currentDegree"),
             "expectedGraduationYear" = COALESCE($7, "expectedGraduationYear"),
             "currentStepKey" = COALESCE($10, "currentStepKey"),
             "updatedAt" = NOW()
         WHERE id = $11`,
        [
          finalSchool,
          finalDegree,
          fieldOfStudy || null,
          startMonth || null,
          parsedStartYear,
          endMonth || null,
          parsedEndYear,
          grade || null,
          activities || null,
          nextStepKey || null,
          profile.id,
        ]
      );
    } else if (sectionKey === 'skills') {
      const { skills } = data;
      if (Array.isArray(skills)) {
        await db.query('DELETE FROM student_skills WHERE "profileId" = $1', [profile.id]);

        for (const item of skills) {
          const prof = ['Beginner', 'Intermediate', 'Advanced'].includes(item.proficiency)
            ? item.proficiency
            : 'Beginner';

          if (item.skillId) {
            await db.query(
              `INSERT INTO student_skills (id, "profileId", "skillId", "customSkillName", proficiency, "createdAt")
               VALUES ($1, $2, $3, NULL, $4, NOW())`,
              [crypto.randomUUID(), profile.id, item.skillId, prof]
            );
          } else if (item.name) {
            await db.query(
              `INSERT INTO student_skills (id, "profileId", "skillId", "customSkillName", proficiency, "createdAt")
               VALUES ($1, $2, NULL, $3, $4, NOW())`,
              [crypto.randomUUID(), profile.id, item.name.trim(), prof]
            );
          }
        }
      }

      await db.query(
        `UPDATE student_profiles
         SET "currentStepKey" = COALESCE($1, "currentStepKey"), "updatedAt" = NOW()
         WHERE id = $2`,
        [nextStepKey || null, profile.id]
      );
    } else if (sectionKey === 'projects_experience') {
      const { projects, experiences, certifications } = data;

      // Handle projects
      if (Array.isArray(projects)) {
        await db.query('DELETE FROM student_projects WHERE "profileId" = $1', [profile.id]);
        for (const proj of projects) {
          if (proj.title && proj.title.trim()) {
            await db.query(
              `INSERT INTO student_projects (
                id, "profileId", title, description, technologies, "projectUrl", "githubUrl", "startDate", "endDate", "isCurrent", "createdAt"
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
              [
                crypto.randomUUID(),
                profile.id,
                proj.title.trim(),
                proj.description || null,
                proj.technologies || [],
                proj.projectUrl || null,
                proj.githubUrl || null,
                proj.startDate || null,
                proj.endDate || null,
                Boolean(proj.isCurrent),
              ]
            );
          }
        }
      }

      // Handle experiences
      if (Array.isArray(experiences)) {
        await db.query('DELETE FROM student_experiences WHERE "profileId" = $1', [profile.id]);
        for (const exp of experiences) {
          if (exp.companyName && exp.roleTitle) {
            await db.query(
              `INSERT INTO student_experiences (
                id, "profileId", "companyName", "roleTitle", "employmentType", location, "startDate", "endDate", "isCurrent", description, "createdAt"
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
              [
                crypto.randomUUID(),
                profile.id,
                exp.companyName.trim(),
                exp.roleTitle.trim(),
                exp.employmentType || 'Internship',
                exp.location || null,
                exp.startDate || null,
                exp.endDate || null,
                Boolean(exp.isCurrent),
                exp.description || null,
              ]
            );
          }
        }
      }

      // Handle certifications
      if (Array.isArray(certifications)) {
        await db.query('DELETE FROM student_certifications WHERE "profileId" = $1', [profile.id]);
        for (const cert of certifications) {
          if (cert.title && cert.title.trim()) {
            await db.query(
              `INSERT INTO student_certifications (
                id, "profileId", title, type, issuer, "issueDate", "expiryDate", "credentialUrl", "credentialId", description, "createdAt"
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
              [
                crypto.randomUUID(),
                profile.id,
                cert.title.trim(),
                cert.type === 'Achievement' ? 'Achievement' : 'Certification',
                cert.issuer || null,
                cert.issueDate || null,
                cert.expiryDate || null,
                cert.credentialUrl || null,
                cert.credentialId || null,
                cert.description || null,
              ]
            );
          }
        }
      }

      await db.query(
        `UPDATE student_profiles
         SET "currentStepKey" = COALESCE($1, "currentStepKey"), "updatedAt" = NOW()
         WHERE id = $2`,
        [nextStepKey || null, profile.id]
      );
    } else if (sectionKey === 'interests_goals') {
      const { workPreferences, areasOfInterest, careerInterests, shortTermGoal, longTermGoal } = data;

      await db.query(
        `UPDATE student_profiles
         SET "workPreferences" = $1, "areasOfInterest" = $2, "careerInterests" = $3,
             "shortTermGoal" = $4, "longTermGoal" = $5,
             "currentStepKey" = COALESCE($6, "currentStepKey"),
             "updatedAt" = NOW()
         WHERE id = $7`,
        [
          Array.isArray(workPreferences) ? workPreferences : [],
          Array.isArray(areasOfInterest) ? areasOfInterest : [],
          Array.isArray(careerInterests) ? careerInterests : [],
          shortTermGoal || null,
          longTermGoal || null,
          nextStepKey || null,
          profile.id,
        ]
      );
    }

    return res.json({ message: 'Progress saved successfully', nextStepKey });
  } catch (err) {
    console.error('Error saving onboarding step:', err);
    return res.status(500).json({ error: 'Failed to save progress' });
  }
});

/**
 * POST /api/onboarding/complete
 * Marks onboarding as complete
 */
router.post('/complete', requireAuth, async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);
    await db.query(
      `UPDATE student_profiles SET "isOnboarded" = true, "updatedAt" = NOW() WHERE id = $1`,
      [profile.id]
    );

    return res.json({ message: 'Onboarding completed successfully', isOnboarded: true });
  } catch (err) {
    console.error('Error completing onboarding:', err);
    return res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

/**
 * PUT /api/profile
 * Allows full profile editing from dashboard
 */
router.put('/', requireAuth, async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);
    const {
      phone,
      headline,
      bio,
      school,
      degree,
      fieldOfStudy,
      startMonth,
      startYear,
      endMonth,
      endYear,
      grade,
      activities,
      university,
      currentDegree,
      semesterOrYear,
      graduationStatus,
      expectedGraduationYear,
      workPreferences,
      areasOfInterest,
      careerInterests,
      shortTermGoal,
      longTermGoal,
      firstName,
      lastName,
    } = req.body;

    if (firstName !== undefined || lastName !== undefined) {
      await db.query(
        `UPDATE users
         SET "firstName" = COALESCE($1, "firstName"),
             "lastName" = COALESCE($2, "lastName"),
             "updatedAt" = NOW()
         WHERE id = $3`,
        [
          firstName !== undefined ? firstName.trim() : null,
          lastName !== undefined ? lastName.trim() : null,
          req.user.id,
        ]
      );
    }

    const finalSchool = school || university || null;
    const finalDegree = degree || currentDegree || null;
    const parsedStartYear = startYear ? parseInt(startYear, 10) : null;
    const parsedEndYear = endYear
      ? parseInt(endYear, 10)
      : expectedGraduationYear
      ? parseInt(expectedGraduationYear, 10)
      : null;

    await db.query(
      `UPDATE student_profiles
       SET phone = COALESCE($1, phone),
           headline = COALESCE($2, headline),
           bio = COALESCE($3, bio),
           school = COALESCE($4, school),
           degree = COALESCE($5, degree),
           "fieldOfStudy" = COALESCE($6, "fieldOfStudy"),
           "startMonth" = COALESCE($7, "startMonth"),
           "startYear" = COALESCE($8, "startYear"),
           "endMonth" = COALESCE($9, "endMonth"),
           "endYear" = COALESCE($10, "endYear"),
           grade = COALESCE($11, grade),
           activities = COALESCE($12, activities),
           university = COALESCE($4, university),
           "currentDegree" = COALESCE($5, "currentDegree"),
           "semesterOrYear" = COALESCE($13, "semesterOrYear"),
           "graduationStatus" = COALESCE($14, "graduationStatus"),
           "expectedGraduationYear" = COALESCE($10, "expectedGraduationYear"),
           "workPreferences" = COALESCE($15, "workPreferences"),
           "areasOfInterest" = COALESCE($16, "areasOfInterest"),
           "careerInterests" = COALESCE($17, "careerInterests"),
           "shortTermGoal" = COALESCE($18, "shortTermGoal"),
           "longTermGoal" = COALESCE($19, "longTermGoal"),
           "updatedAt" = NOW()
       WHERE id = $20`,
      [
        phone !== undefined ? phone : null,
        headline !== undefined ? headline : null,
        bio !== undefined ? bio : null,
        finalSchool,
        finalDegree,
        fieldOfStudy !== undefined ? fieldOfStudy : null,
        startMonth !== undefined ? startMonth : null,
        parsedStartYear,
        endMonth !== undefined ? endMonth : null,
        parsedEndYear,
        grade !== undefined ? grade : null,
        activities !== undefined ? activities : null,
        semesterOrYear !== undefined ? semesterOrYear : null,
        graduationStatus !== undefined ? graduationStatus : null,
        workPreferences !== undefined ? workPreferences : null,
        areasOfInterest !== undefined ? areasOfInterest : null,
        careerInterests !== undefined ? careerInterests : null,
        shortTermGoal !== undefined ? shortTermGoal : null,
        longTermGoal !== undefined ? longTermGoal : null,
        profile.id,
      ]
    );

    return res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Error updating profile:', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Single-item sub-resource CRUD endpoints
router.post('/projects', requireAuth, async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);
    const { title, description, technologies, projectUrl, githubUrl, startDate, endDate, isCurrent } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Project title is required' });
    }

    const newId = crypto.randomUUID();
    const result = await db.query(
      `INSERT INTO student_projects (
        id, "profileId", title, description, technologies, "projectUrl", "githubUrl", "startDate", "endDate", "isCurrent", "createdAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *`,
      [
        newId,
        profile.id,
        title.trim(),
        description || null,
        technologies || [],
        projectUrl || null,
        githubUrl || null,
        startDate || null,
        endDate || null,
        Boolean(isCurrent),
      ]
    );

    return res.status(201).json({ project: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to add project' });
  }
});

router.delete('/projects/:id', requireAuth, async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);
    await db.query('DELETE FROM student_projects WHERE id = $1 AND "profileId" = $2', [req.params.id, profile.id]);
    return res.json({ message: 'Project removed' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete project' });
  }
});

router.post('/experiences', requireAuth, async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);
    const { companyName, roleTitle, employmentType, location, startDate, endDate, isCurrent, description } = req.body;

    if (!companyName || !roleTitle) {
      return res.status(400).json({ error: 'Company name and role title are required' });
    }

    const newId = crypto.randomUUID();
    const result = await db.query(
      `INSERT INTO student_experiences (
        id, "profileId", "companyName", "roleTitle", "employmentType", location, "startDate", "endDate", "isCurrent", description, "createdAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *`,
      [
        newId,
        profile.id,
        companyName.trim(),
        roleTitle.trim(),
        employmentType || 'Internship',
        location || null,
        startDate || null,
        endDate || null,
        Boolean(isCurrent),
        description || null,
      ]
    );

    return res.status(201).json({ experience: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to add experience' });
  }
});

router.delete('/experiences/:id', requireAuth, async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);
    await db.query('DELETE FROM student_experiences WHERE id = $1 AND "profileId" = $2', [req.params.id, profile.id]);
    return res.json({ message: 'Experience removed' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete experience' });
  }
});

router.post('/certifications', requireAuth, async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);
    const { title, type, issuer, issueDate, expiryDate, credentialUrl, credentialId, description } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const newId = crypto.randomUUID();
    const result = await db.query(
      `INSERT INTO student_certifications (
        id, "profileId", title, type, issuer, "issueDate", "expiryDate", "credentialUrl", "credentialId", description, "createdAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *`,
      [
        newId,
        profile.id,
        title.trim(),
        type === 'Achievement' ? 'Achievement' : 'Certification',
        issuer || null,
        issueDate || null,
        expiryDate || null,
        credentialUrl || null,
        credentialId || null,
        description || null,
      ]
    );

    return res.status(201).json({ certification: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to add certification' });
  }
});

router.delete('/certifications/:id', requireAuth, async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);
    await db.query('DELETE FROM student_certifications WHERE id = $1 AND "profileId" = $2', [req.params.id, profile.id]);
    return res.json({ message: 'Certification removed' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete certification' });
  }
});

router.delete('/skills/:id', requireAuth, async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);
    await db.query('DELETE FROM student_skills WHERE id = $1 AND "profileId" = $2', [req.params.id, profile.id]);
    return res.json({ message: 'Skill removed' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete skill' });
  }
});

module.exports = router;
