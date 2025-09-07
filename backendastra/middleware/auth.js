const jwt = require('jsonwebtoken');
const User = require('../models/User');

const userModel = new User(); // Instantiate the User model

const authenticateUser = async (req, res, next) => {
  try {
    const token = req.cookies.authToken;
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'No authentication token provided' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await userModel.findById(decoded.userId);
    
    if (!user) {
      // Clear invalid cookie
      res.clearCookie('authToken');
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token - user not found' 
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    
    // Clear invalid cookie
    res.clearCookie('authToken');
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired' 
      });
    }
    
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid or expired token' 
    });
  }
};

const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: `Access denied. Required roles: ${allowedRoles.join(', ')}` 
      });
    }
    
    next();
  };
};

const checkPermissions = {
  canManageAnnouncements: (user) => user && user.role === 'admin',
  canAddEditorials: (user) => user && ['admin', 'mentor'].includes(user.role),
  canManageUsers: (user) => user && user.role === 'admin',
  canManageSheets: (user) => user && user.role === 'admin',
  canAddProblems: (user) => user && user.role === 'admin'
};

module.exports = {
  authenticateUser,
  requireRole,
  checkPermissions
};
