const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

// All endpoints in this router require ADMIN privileges
router.use(requireAdmin);

/**
 * GET /api/admin/onboarding/sections
 * Returns all configured onboarding sections
 */
router.get('/sections', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, key, title, description, "stepOrder", "isEnabled", "fieldsConfig", "updatedAt" FROM onboarding_sections ORDER BY "stepOrder" ASC'
    );
    return res.json({ sections: result.rows });
  } catch (err) {
    console.error('Error fetching onboarding sections:', err);
    return res.status(500).json({ error: 'Failed to fetch sections' });
  }
});

/**
 * PUT /api/admin/onboarding/sections/:key
 * Update an onboarding section's enabled status, titles, or field requirements
 */
router.put('/sections/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { title, description, isEnabled, stepOrder, fieldsConfig } = req.body;

    const existing = await db.query('SELECT * FROM onboarding_sections WHERE key = $1', [key]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }

    const current = existing.rows[0];
    const newTitle = title !== undefined ? title : current.title;
    const newDesc = description !== undefined ? description : current.description;
    const newEnabled = isEnabled !== undefined ? Boolean(isEnabled) : current.isEnabled;
    const newOrder = stepOrder !== undefined ? parseInt(stepOrder, 10) : current.stepOrder;
    const newFieldsConfig = fieldsConfig !== undefined ? fieldsConfig : current.fieldsConfig;

    const result = await db.query(
      `UPDATE onboarding_sections
       SET title = $1, description = $2, "isEnabled" = $3, "stepOrder" = $4, "fieldsConfig" = $5, "updatedAt" = NOW()
       WHERE key = $6
       RETURNING id, key, title, description, "stepOrder", "isEnabled", "fieldsConfig", "updatedAt"`,
      [newTitle, newDesc, newEnabled, newOrder, JSON.stringify(newFieldsConfig), key]
    );

    return res.json({
      message: 'Section configuration updated successfully',
      section: result.rows[0],
    });
  } catch (err) {
    console.error('Error updating onboarding section:', err);
    return res.status(500).json({ error: 'Failed to update section' });
  }
});

/**
 * PUT /api/admin/onboarding/sections-order
 * Reorder sections
 */
router.put('/sections-order', async (req, res) => {
  try {
    const { orders } = req.body; // array of { key, stepOrder }
    if (!Array.isArray(orders)) {
      return res.status(400).json({ error: 'Array of orders is required' });
    }

    for (const item of orders) {
      if (item.key && typeof item.stepOrder === 'number') {
        await db.query(
          'UPDATE onboarding_sections SET "stepOrder" = $1, "updatedAt" = NOW() WHERE key = $2',
          [item.stepOrder, item.key]
        );
      }
    }

    const result = await db.query(
      'SELECT id, key, title, description, "stepOrder", "isEnabled", "fieldsConfig", "updatedAt" FROM onboarding_sections ORDER BY "stepOrder" ASC'
    );
    return res.json({ message: 'Sections reordered successfully', sections: result.rows });
  } catch (err) {
    console.error('Error reordering sections:', err);
    return res.status(500).json({ error: 'Failed to reorder sections' });
  }
});

/**
 * GET /api/admin/onboarding/catalogs
 * Returns all catalog entries (degrees, skills, and option pills)
 */
router.get('/catalogs', async (req, res) => {
  try {
    const [degreesRes, skillsRes, optionsRes] = await Promise.all([
      db.query('SELECT * FROM catalog_degrees ORDER BY "displayOrder" ASC, name ASC'),
      db.query('SELECT * FROM catalog_skills ORDER BY category ASC, name ASC'),
      db.query('SELECT * FROM catalog_options ORDER BY type ASC, "displayOrder" ASC, label ASC'),
    ]);

    return res.json({
      degrees: degreesRes.rows,
      skills: skillsRes.rows,
      options: optionsRes.rows,
    });
  } catch (err) {
    console.error('Error fetching catalogs:', err);
    return res.status(500).json({ error: 'Failed to fetch catalogs' });
  }
});

// Degrees Management
router.post('/catalogs/degrees', async (req, res) => {
  try {
    const { name, department, isActive, displayOrder } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Degree name is required' });
    }

    const id = crypto.randomUUID();
    const result = await db.query(
      `INSERT INTO catalog_degrees (id, name, department, "isActive", "displayOrder", "createdAt")
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [
        id,
        name.trim(),
        department !== undefined ? department.trim() : '',
        isActive !== undefined ? Boolean(isActive) : true,
        displayOrder ? parseInt(displayOrder, 10) : 0,
      ]
    );

    return res.status(201).json({ message: 'Degree added', degree: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'A degree with this name already exists' });
    }
    return res.status(500).json({ error: 'Failed to add degree' });
  }
});

router.put('/catalogs/degrees/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, department, isActive, displayOrder } = req.body;

    const existing = await db.query('SELECT * FROM catalog_degrees WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Degree not found' });
    }

    const current = existing.rows[0];
    const result = await db.query(
      `UPDATE catalog_degrees
       SET name = COALESCE($1, name),
           department = COALESCE($2, department),
           "isActive" = COALESCE($3, "isActive"),
           "displayOrder" = COALESCE($4, "displayOrder")
       WHERE id = $5
       RETURNING *`,
      [
        name !== undefined ? name.trim() : null,
        department !== undefined ? department.trim() : null,
        isActive !== undefined ? Boolean(isActive) : null,
        displayOrder !== undefined ? parseInt(displayOrder, 10) : null,
        id,
      ]
    );

    return res.json({ message: 'Degree updated', degree: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'A degree with this name already exists' });
    }
    return res.status(500).json({ error: 'Failed to update degree' });
  }
});

router.delete('/catalogs/degrees/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM catalog_degrees WHERE id = $1', [id]);
    return res.json({ message: 'Degree deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete degree' });
  }
});

// Skills Management
router.post('/catalogs/skills', async (req, res) => {
  try {
    const { name, category, isActive } = req.body;
    if (!name || !name.trim() || !category || !category.trim()) {
      return res.status(400).json({ error: 'Skill name and category are required' });
    }

    const id = crypto.randomUUID();
    const result = await db.query(
      `INSERT INTO catalog_skills (id, name, category, "isActive", "createdAt")
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [id, name.trim(), category.trim(), isActive !== undefined ? Boolean(isActive) : true]
    );

    return res.status(201).json({ message: 'Skill added', skill: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'A skill with this name already exists' });
    }
    return res.status(500).json({ error: 'Failed to add skill' });
  }
});

router.put('/catalogs/skills/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, isActive } = req.body;

    const existing = await db.query('SELECT * FROM catalog_skills WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    const result = await db.query(
      `UPDATE catalog_skills
       SET name = COALESCE($1, name),
           category = COALESCE($2, category),
           "isActive" = COALESCE($3, "isActive")
       WHERE id = $4
       RETURNING *`,
      [
        name !== undefined ? name.trim() : null,
        category !== undefined ? category.trim() : null,
        isActive !== undefined ? Boolean(isActive) : null,
        id,
      ]
    );

    return res.json({ message: 'Skill updated', skill: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'A skill with this name already exists' });
    }
    return res.status(500).json({ error: 'Failed to update skill' });
  }
});

router.delete('/catalogs/skills/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM catalog_skills WHERE id = $1', [id]);
    return res.json({ message: 'Skill deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete skill' });
  }
});

// Options Management (Interests, Career, Preferences, etc.)
router.post('/catalogs/options', async (req, res) => {
  try {
    const { type, label, isActive, displayOrder } = req.body;
    if (!type || !label || !label.trim()) {
      return res.status(400).json({ error: 'Option type and label are required' });
    }

    const id = crypto.randomUUID();
    const result = await db.query(
      `INSERT INTO catalog_options (id, type, label, "isActive", "displayOrder", "createdAt")
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [
        id,
        type.trim(),
        label.trim(),
        isActive !== undefined ? Boolean(isActive) : true,
        displayOrder ? parseInt(displayOrder, 10) : 0,
      ]
    );

    return res.status(201).json({ message: 'Option added', option: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'This option already exists in this category' });
    }
    return res.status(500).json({ error: 'Failed to add option' });
  }
});

router.put('/catalogs/options/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { label, isActive, displayOrder } = req.body;

    const existing = await db.query('SELECT * FROM catalog_options WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Option not found' });
    }

    const result = await db.query(
      `UPDATE catalog_options
       SET label = COALESCE($1, label),
           "isActive" = COALESCE($2, "isActive"),
           "displayOrder" = COALESCE($3, "displayOrder")
       WHERE id = $4
       RETURNING *`,
      [
        label !== undefined ? label.trim() : null,
        isActive !== undefined ? Boolean(isActive) : null,
        displayOrder !== undefined ? parseInt(displayOrder, 10) : null,
        id,
      ]
    );

    return res.json({ message: 'Option updated', option: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update option' });
  }
});

router.delete('/catalogs/options/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM catalog_options WHERE id = $1', [id]);
    return res.json({ message: 'Option deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete option' });
  }
});

/**
 * GET /api/admin/onboarding/stats
 * Real-time metrics on onboarding completions and drop-offs
 */
router.get('/stats', async (req, res) => {
  try {
    const [totalStudentsRes, onboardedRes, inProgressRes, stepBreakdownRes] = await Promise.all([
      db.query("SELECT COUNT(*) AS count FROM users WHERE role = 'STUDENT'"),
      db.query("SELECT COUNT(*) AS count FROM student_profiles WHERE \"isOnboarded\" = true"),
      db.query("SELECT COUNT(*) AS count FROM student_profiles WHERE \"isOnboarded\" = false"),
      db.query(
        `SELECT "currentStepKey", COUNT(*) AS count
         FROM student_profiles
         WHERE "isOnboarded" = false
         GROUP BY "currentStepKey"`
      ),
    ]);

    const totalStudents = parseInt(totalStudentsRes.rows[0]?.count || 0, 10);
    const onboardedCount = parseInt(onboardedRes.rows[0]?.count || 0, 10);
    const inProgressCount = parseInt(inProgressRes.rows[0]?.count || 0, 10);
    const completionRate = totalStudents > 0 ? Math.round((onboardedCount / totalStudents) * 100) : 0;

    return res.json({
      totalStudents,
      onboardedCount,
      inProgressCount,
      completionRate,
      stepBreakdown: stepBreakdownRes.rows,
    });
  } catch (err) {
    console.error('Error fetching onboarding stats:', err);
    return res.status(500).json({ error: 'Failed to fetch onboarding stats' });
  }
});

module.exports = router;
