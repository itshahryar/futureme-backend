const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'futureme_secret_dev_key_2026';

// Format user record for client
const formatUser = (row) => {
  const fName = row.firstName ?? row.firstname ?? (row.name ? row.name.split(' ')[0] : '') ?? '';
  const lName = row.lastName ?? row.lastname ?? (row.name ? row.name.split(' ').slice(1).join(' ') : '') ?? '';
  const fullName = [fName, lName].filter(Boolean).join(' ') || fName;

  return {
    id: row.id,
    firstName: fName,
    lastName: lName,
    name: fullName,
    email: row.email,
    role: row.role,
    isActive: row.isActive ?? row.isactive,
    createdAt: row.createdAt ?? row.createdat,
    updatedAt: row.updatedAt ?? row.updatedat,
  };
};

// Middleware: Require authenticated ADMIN role
const requireAdmin = async (req, res, next) => {
  try {
    let token = req.cookies?.token;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const userResult = await db.query(
      'SELECT id, role, "isActive" FROM users WHERE id = $1',
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    if (!(user.isActive ?? user.isactive)) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    if (user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied: Admin privileges required' });
    }

    req.admin = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired authentication session' });
  }
};

// In-memory cache for paginated/filtered user queries (60s TTL)
const usersCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

const getFromCache = (key) => {
  const entry = usersCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    usersCache.delete(key);
    return null;
  }
  return entry.data;
};

const setToCache = (key, data, ttl = CACHE_TTL_MS) => {
  if (usersCache.size > 200) {
    const oldestKey = usersCache.keys().next().value;
    usersCache.delete(oldestKey);
  }
  usersCache.set(key, { data, expiry: Date.now() + ttl });
};

const clearUsersCache = () => {
  usersCache.clear();
};

/**
 * GET /api/users
 * Returns paginated users (default 15 per page) with search, role filters, and caching (ADMIN only)
 */
router.get('/', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 15, 100));
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const role = (req.query.role || '').trim().toUpperCase();

    const cacheKey = `users:p${page}:l${limit}:s${search}:r${role}`;
    const cachedResponse = getFromCache(cacheKey);
    if (cachedResponse) {
      res.set('X-Cache', 'HIT');
      return res.json(cachedResponse);
    }

    // Build filter conditions
    const conditions = [];
    const values = [];

    if (role && role !== 'ALL') {
      values.push(role);
      conditions.push(`role = $${values.length}`);
    }

    if (search) {
      values.push(`%${search}%`);
      const sParam = `$${values.length}`;
      conditions.push(`(
        COALESCE("firstName", '') ILIKE ${sParam} OR 
        COALESCE("lastName", '') ILIKE ${sParam} OR 
        COALESCE(name, '') ILIKE ${sParam} OR 
        email ILIKE ${sParam}
      )`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Overall KPI counts (Total, Students, Admins across entire system)
    const countsPromise = db.query(`
      SELECT 
        COUNT(*)::int AS "total",
        COUNT(CASE WHEN role = 'STUDENT' THEN 1 END)::int AS "students",
        COUNT(CASE WHEN role = 'ADMIN' THEN 1 END)::int AS "admins"
      FROM users
    `);

    // Filtered total count
    const totalCountPromise = db.query(
      `SELECT COUNT(*)::int AS "filteredTotal" FROM users ${whereClause}`,
      values
    );

    // Filtered paginated records
    const dataValues = [...values, limit, offset];
    const dataPromise = db.query(
      `SELECT id, "firstName", "lastName", email, role, "isActive", "createdAt", "updatedAt"
       FROM users
       ${whereClause}
       ORDER BY "createdAt" DESC
       LIMIT $${dataValues.length - 1} OFFSET $${dataValues.length}`,
      dataValues
    );

    const [countsResult, totalCountResult, dataResult] = await Promise.all([
      countsPromise,
      totalCountPromise,
      dataPromise,
    ]);

    const total = totalCountResult.rows[0]?.filteredTotal || 0;
    const totalPages = Math.ceil(total / limit) || 1;
    const users = dataResult.rows.map(formatUser);

    const hasMore = page < totalPages;
    const totalUsers = Number(countsResult.rows[0]?.total || 0);
    const totalStudents = Number(countsResult.rows[0]?.students || 0);
    const totalAdmins = Number(countsResult.rows[0]?.admins || 0);

    const responsePayload = {
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore,
      },
      counts: {
        total: totalUsers,
        students: totalStudents,
        admins: totalAdmins,
      },
    };

    setToCache(cacheKey, responsePayload);
    res.set('X-Cache', 'MISS');
    return res.json(responsePayload);
  } catch (error) {
    console.error('Fetch users error:', error);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * PUT /api/users/:id
 * Admin updates user details (firstName, lastName, email, isActive).
 * Disallows editing administrators.
 */
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, email, isActive } = req.body;

    // Check target user
    const existingResult = await db.query(
      'SELECT id, role, email FROM users WHERE id = $1',
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetUser = existingResult.rows[0];

    // RULE: Cannot edit administrators from this panel
    if (targetUser.role === 'ADMIN') {
      return res.status(403).json({
        error: 'Admin accounts are protected and cannot be modified from this table.',
      });
    }

    // Validation
    const finalFirstName = (firstName || '').trim();
    const finalLastName = (lastName || '').trim();
    const finalEmail = (email || '').trim().toLowerCase();

    if (!finalFirstName) {
      return res.status(400).json({ error: 'First name is required' });
    }

    if (!finalEmail) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if new email is taken by another user
    if (finalEmail !== targetUser.email.toLowerCase()) {
      const emailCheck = await db.query(
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2',
        [finalEmail, id]
      );
      if (emailCheck.rows.length > 0) {
        return res.status(409).json({ error: 'This email is already in use by another account' });
      }
    }

    const activeStatus = typeof isActive === 'boolean' ? isActive : true;

    const updateResult = await db.query(
      `UPDATE users
       SET "firstName" = $1, "lastName" = $2, email = $3, "isActive" = $4, "updatedAt" = NOW()
       WHERE id = $5
       RETURNING id, "firstName", "lastName", email, role, "isActive", "createdAt", "updatedAt"`,
      [finalFirstName, finalLastName, finalEmail, activeStatus, id]
    );

    clearUsersCache();

    return res.json({
      message: 'User updated successfully',
      user: formatUser(updateResult.rows[0]),
    });
  } catch (error) {
    console.error('Admin update user error:', error);
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

module.exports = router;
module.exports.clearUsersCache = clearUsersCache;
