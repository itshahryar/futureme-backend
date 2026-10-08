const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'futureme_secret_dev_key_2026';

// Session duration: 1 day (24 hours)
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const JWT_EXPIRES_IN = '1d';

// Cookie options for HTTP-only JWT
const COOKIE_OPTIONS = {
  httpOnly: true, // Prevents client-side JS / XSS access
  secure: process.env.NODE_ENV === 'production', // true in production (HTTPS)
  sameSite: 'lax', // CSRF mitigation while allowing top-level navigation
  maxAge: ONE_DAY_MS, // 1 day (24 hours)
};

// Format user output for client
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

/**
 * POST /api/auth/register
 * Body: { firstName, lastName, email, password, role }
 * Sets HTTP-only cookie and returns user
 */
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, name, email, password, role } = req.body;

    let finalFirstName = (firstName || '').trim();
    let finalLastName = (lastName || '').trim();

    if (!finalFirstName && name) {
      const parts = name.trim().split(' ');
      finalFirstName = parts[0] || '';
      finalLastName = parts.slice(1).join(' ') || '';
    }

    if (!finalFirstName || !email || !password) {
      return res.status(400).json({ error: 'First name, email, and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const assignedRole = role === 'ADMIN' ? 'ADMIN' : 'STUDENT';

    // Check if email already exists in Neon PostgreSQL
    const existing = await db.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [normalizedEmail]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const id = crypto.randomUUID();

    // Insert user into Neon PostgreSQL
    const result = await db.query(
      `INSERT INTO users (id, "firstName", "lastName", email, "passwordHash", role, "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING id, "firstName", "lastName", email, role, "isActive", "createdAt", "updatedAt"`,
      [id, finalFirstName, finalLastName, normalizedEmail, passwordHash, assignedRole, true]
    );

    const newUser = result.rows[0];

    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, role: newUser.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Set secure HTTP-only cookie
    res.cookie('token', token, COOKIE_OPTIONS);

    return res.status(201).json({
      message: 'Account created successfully',
      user: formatUser(newUser),
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Failed to create account. Please try again.' });
  }
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Sets HTTP-only cookie and returns user
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Find user in Neon PostgreSQL
    const result = await db.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    if (!(user.isActive ?? user.isactive)) {
      return res.status(403).json({ error: 'This account has been deactivated. Please contact an admin.' });
    }

    const passwordHash = user.passwordHash || user.passwordhash;
    const isMatch = await bcrypt.compare(password, passwordHash);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Set secure HTTP-only cookie
    res.cookie('token', token, COOKIE_OPTIONS);

    return res.json({
      message: 'Logged in successfully',
      user: formatUser(user),
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Failed to login. Please try again.' });
  }
});

/**
 * POST /api/auth/logout
 * Clears the HTTP-only cookie
 */
router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return res.json({ message: 'Logged out successfully' });
});

/**
 * GET /api/auth/me
 * Reads token from HTTP-only cookie or Authorization header
 */
router.get('/me', async (req, res) => {
  try {
    // 1. Try reading from HTTP-only cookie
    let token = req.cookies?.token;

    // 2. Fallback to Authorization header if provided
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const result = await db.query(
      'SELECT id, "firstName", "lastName", email, role, "isActive", "createdAt", "updatedAt" FROM users WHERE id = $1',
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user: formatUser(result.rows[0]) });
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired authentication session' });
  }
});

/**
 * PUT /api/auth/profile
 * Allows updating firstName and lastName.
 * Email and role cannot be changed.
 */
router.put('/profile', async (req, res) => {
  try {
    let token = req.cookies?.token;

    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const { firstName, lastName, name } = req.body;

    let finalFirstName = firstName !== undefined ? firstName.trim() : '';
    let finalLastName = lastName !== undefined ? lastName.trim() : '';

    if (!finalFirstName && name) {
      const parts = name.trim().split(' ');
      finalFirstName = parts[0] || '';
      finalLastName = parts.slice(1).join(' ') || '';
    }

    if (!finalFirstName) {
      return res.status(400).json({ error: 'First name is required' });
    }

    // Only update firstName, lastName, and updatedAt. Email and role are protected.
    const result = await db.query(
      `UPDATE users
       SET "firstName" = $1, "lastName" = $2, "updatedAt" = NOW()
       WHERE id = $3
       RETURNING id, "firstName", "lastName", email, role, "isActive", "createdAt", "updatedAt"`,
      [finalFirstName, finalLastName, decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      message: 'Profile updated successfully',
      user: formatUser(result.rows[0]),
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * PUT /api/auth/change-password
 * Body: { currentPassword, newPassword }
 * Authenticates user, verifies current password, hashes new password, and updates Neon DB
 */
router.put('/change-password', async (req, res) => {
  try {
    let token = req.cookies?.token;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }

    // Retrieve user from DB to verify current password
    const userResult = await db.query(
      'SELECT id, "passwordHash" FROM users WHERE id = $1',
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const passwordHash = user.passwordHash || user.passwordhash;
    const isMatch = await bcrypt.compare(currentPassword, passwordHash);

    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Hash new password and update in Neon PostgreSQL
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    await db.query(
      'UPDATE users SET "passwordHash" = $1, "updatedAt" = NOW() WHERE id = $2',
      [newPasswordHash, decoded.id]
    );

    return res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: 'Failed to change password. Please try again.' });
  }
});

module.exports = router;
