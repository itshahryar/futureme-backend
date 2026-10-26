const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'futureme_secret_dev_key_2026';

const extractToken = (req) => {
  let token = req.cookies?.token;
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }
  return token;
};

/**
 * Middleware: Verify user is logged in
 */
const requireAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userResult = await db.query(
      'SELECT id, "firstName", "lastName", email, role, "isActive" FROM users WHERE id = $1',
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const isActive = user.isActive ?? user.isactive;
    if (!isActive) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    req.user = {
      id: user.id,
      firstName: user.firstName ?? user.firstname,
      lastName: user.lastName ?? user.lastname,
      email: user.email,
      role: user.role,
    };

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
};

/**
 * Middleware: Verify user has ADMIN role
 */
const requireAdmin = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userResult = await db.query(
      'SELECT id, "firstName", "lastName", email, role, "isActive" FROM users WHERE id = $1',
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const isActive = user.isActive ?? user.isactive;
    if (!isActive) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    if (user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied: Admin privileges required' });
    }

    req.user = {
      id: user.id,
      firstName: user.firstName ?? user.firstname,
      lastName: user.lastName ?? user.lastname,
      email: user.email,
      role: user.role,
    };
    req.admin = req.user;

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
};

module.exports = {
  requireAuth,
  requireAdmin,
};
